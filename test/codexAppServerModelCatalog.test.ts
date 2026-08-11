import { assert } from "chai";
import {
  buildCodexRuntimeModelEntries,
  ensureCodexAppServerModelCapabilities,
  getCodexAppServerReasoningChoices,
  loadCodexAppServerModelCapabilities,
  loadCodexAppServerModelCatalog,
  parseCodexModelCatalogContextWindows,
  parseCodexModelCatalogPathDirective,
  reconcileCodexAppServerReasoningMode,
  resetCodexAppServerModelCatalogStateForTests,
  resolveCodexConfigPath,
  resolveCodexAppServerReasoningSelection,
} from "../src/codexAppServer/modelCatalog";
import {
  getModelInputTokenLimit,
  applyModelInputTokenCap,
} from "../src/utils/modelInputCap";
import { resetModelCapabilityStateForTests } from "../src/modelCapabilities";

describe("Codex app-server model catalog", function () {
  afterEach(function () {
    resetModelCapabilityStateForTests();
    resetCodexAppServerModelCatalogStateForTests();
  });

  it("loads all model/list pages and normalizes visible models for the menu", async function () {
    const calls: Array<{
      cursor?: string;
      includeHidden?: boolean;
      limit?: number;
    }> = [];

    const catalog = await loadCodexAppServerModelCatalog({
      codexPath: "/opt/codex/bin/codex",
      listModels: async (params) => {
        calls.push({
          cursor: params.cursor,
          includeHidden: params.includeHidden,
          limit: params.limit,
        });
        if (!params.cursor) {
          return {
            data: [
              {
                id: "model-fast",
                model: "gpt-5.5-fast",
                displayName: "GPT-5.5 Fast",
                description: "Fast Codex model",
                hidden: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Low" },
                  { reasoningEffort: "high", description: "High" },
                ],
                defaultReasoningEffort: "high",
              },
              {
                id: "model-hidden",
                model: "gpt-5.5-hidden",
                displayName: "Hidden",
                hidden: true,
              },
            ],
            nextCursor: "page-2",
          };
        }
        return {
          data: [
            {
              id: "model-thinking",
              model: "gpt-5.5-thinking",
              displayName: "",
              description: "Thinking Codex model",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Medium" },
              ],
              defaultReasoningEffort: "medium",
            },
          ],
          nextCursor: null,
        };
      },
    });

    assert.deepEqual(calls, [
      { cursor: undefined, includeHidden: false, limit: 100 },
      { cursor: "page-2", includeHidden: false, limit: 100 },
    ]);
    assert.deepEqual(
      catalog.models.map((model) => ({
        model: model.model,
        displayName: model.displayName,
        hidden: model.hidden,
        efforts: model.supportedReasoningEfforts,
        defaultEffort: model.defaultReasoningEffort,
      })),
      [
        {
          model: "gpt-5.5-fast",
          displayName: "GPT-5.5 Fast",
          hidden: false,
          efforts: ["low", "high"],
          defaultEffort: "high",
        },
        {
          model: "gpt-5.5-thinking",
          displayName: "gpt-5.5-thinking",
          hidden: false,
          efforts: ["medium"],
          defaultEffort: "medium",
        },
      ],
    );

    const entries = buildCodexRuntimeModelEntries({
      models: catalog.models,
      selectedModel: "gpt-5.5-fast",
      codexPath: "/opt/codex/bin/codex",
    });

    assert.deepEqual(
      entries.map((entry) => ({
        entryId: entry.entryId,
        model: entry.model,
        apiBase: entry.apiBase,
        providerLabel: entry.providerLabel,
        displayModelLabel: entry.displayModelLabel,
        authMode: entry.authMode,
        providerProtocol: entry.providerProtocol,
        advanced: entry.advanced,
      })),
      [
        {
          entryId: "codex_app_server::gpt-5.5-fast",
          model: "gpt-5.5-fast",
          apiBase: "/opt/codex/bin/codex",
          providerLabel: "Codex",
          displayModelLabel: "GPT-5.5 Fast",
          authMode: "codex_app_server",
          providerProtocol: "codex_responses",
          advanced: { temperature: 0.3, maxTokens: 4096 },
        },
        {
          entryId: "codex_app_server::gpt-5.5-thinking",
          model: "gpt-5.5-thinking",
          apiBase: "/opt/codex/bin/codex",
          providerLabel: "Codex",
          displayModelLabel: "gpt-5.5-thinking",
          authMode: "codex_app_server",
          providerProtocol: "codex_responses",
          advanced: { temperature: 0.3, maxTokens: 4096 },
        },
      ],
    );
  });

  it("keeps the currently selected Codex model as a fallback entry when it is not listed", function () {
    const entries = buildCodexRuntimeModelEntries({
      models: [
        {
          id: "model-fast",
          model: "gpt-5.5-fast",
          displayName: "GPT-5.5 Fast",
          hidden: false,
          description: "",
          supportedReasoningEfforts: [],
        },
      ],
      selectedModel: "gpt-5.5-custom",
      codexPath: "",
    });

    assert.deepEqual(
      entries.map((entry) => ({
        entryId: entry.entryId,
        model: entry.model,
        displayModelLabel: entry.displayModelLabel,
      })),
      [
        {
          entryId: "codex_app_server::gpt-5.5-custom",
          model: "gpt-5.5-custom",
          displayModelLabel: "gpt-5.5-custom",
        },
        {
          entryId: "codex_app_server::gpt-5.5-fast",
          model: "gpt-5.5-fast",
          displayModelLabel: "GPT-5.5 Fast",
        },
      ],
    );
  });

  it("preserves optional app-server context limits for future model/list entries", async function () {
    const catalog = await loadCodexAppServerModelCatalog({
      listModels: async () => ({
        data: [
          {
            id: "future-model",
            model: "third-party/future-model",
            displayName: "Future model",
            context_window: 777_000,
            max_context_window: 1_000_000,
          },
        ],
      }),
    });
    assert.deepEqual(catalog.models, [
      {
        id: "future-model",
        model: "third-party/future-model",
        displayName: "Future model",
        description: "",
        hidden: false,
        supportedReasoningEfforts: [],
        contextWindowTokens: 777_000,
        maxContextWindowTokens: 1_000_000,
      },
    ]);
  });

  it("loads only whitelisted local catalog window fields into the exact native capability snapshot", async function () {
    const configuredCatalogPath = "/tmp/codex-models.json";
    const files = new Map<string, string>([
      [
        "/tmp/config.toml",
        `model_catalog_json = "${configuredCatalogPath}"\napi_key = "must-not-be-parsed"`,
      ],
      [
        configuredCatalogPath,
        JSON.stringify({
          models: [
            {
              slug: "opencode-go/deepseek-v4-flash[1m]",
              context_window: 1_048_576,
              max_context_window: 1_048_576,
              model: "alias-that-must-not-be-used",
            },
            { slug: "invalid-window", context_window: "1048576" },
            { model: "missing-slug", context_window: 900_000 },
          ],
        }),
      ],
    ]);
    await ensureCodexAppServerModelCapabilities({
      model: "opencode-go/deepseek-v4-flash[1m]",
      codexPath: "/usr/local/bin/codex",
      configPath: "/tmp/config.toml",
      readTextFile: async (path) => {
        const file = files.get(path);
        if (file === undefined) throw new Error(`unexpected read: ${path}`);
        return file;
      },
      listModels: async () => ({
        data: [
          {
            id: "future-id",
            model: "third-party/future-model",
            contextWindow: 777_000,
          },
        ],
      }),
    });

    const nativeIdentity = {
      apiBase: "/usr/local/bin/codex",
      protocol: "codex_responses",
      authMode: "codex_app_server",
    } as const;
    assert.equal(
      getModelInputTokenLimit(
        "opencode-go/deepseek-v4-flash[1m]",
        nativeIdentity,
      ),
      1_048_576,
    );
    assert.equal(
      getModelInputTokenLimit("third-party/future-model", nativeIdentity),
      777_000,
    );
    assert.equal(
      getModelInputTokenLimit("alias-that-must-not-be-used", nativeIdentity),
      128_000,
    );
    const capped = applyModelInputTokenCap(
      [{ role: "user", content: "small request" }],
      "opencode-go/deepseek-v4-flash[1m]",
      undefined,
      nativeIdentity,
    );
    assert.equal(capped.limitTokens, 1_048_576);
  });

  it("rejects malformed catalog directives and invalid local model windows", function () {
    assert.equal(
      parseCodexModelCatalogPathDirective(
        'model_catalog_json = "/root/models.json"\n[profiles.local]\nmodel_catalog_json = "/wrong/models.json"',
      ),
      "/root/models.json",
    );
    assert.isNull(
      parseCodexModelCatalogPathDirective(
        '[profiles.local]\nmodel_catalog_json = "/wrong/models.json"',
      ),
    );
    assert.isNull(
      parseCodexModelCatalogPathDirective("model_catalog_json = path"),
    );
    assert.deepEqual(
      parseCodexModelCatalogContextWindows(
        JSON.stringify({
          models: [
            { slug: "too-large", context_window: 100_000_001 },
            { slug: "string-window", context_window: "512000" },
            { slug: "fallback", max_context_window: 512_000 },
          ],
        }),
      ),
      [
        {
          id: "fallback",
          limits: { contextWindowTokens: 512_000, inputTokens: 512_000 },
          source: "live",
        },
      ],
    );
  });

  it("uses CODEX_HOME ahead of the conventional home directory", function () {
    assert.equal(
      resolveCodexConfigPath({
        codexHome: "/runtime/codex-home",
        homeDir: "/Users/example",
      }),
      "/runtime/codex-home/config.toml",
    );
    assert.equal(
      resolveCodexConfigPath({ homeDir: "/Users/example" }),
      "/Users/example/.codex/config.toml",
    );
  });

  it("resolves the live Zotero home and IO globals through ztoolkit", async function () {
    const runtime = globalThis as unknown as {
      ztoolkit?: { getGlobal?: (key: string) => unknown };
    };
    const previousToolkit = runtime.ztoolkit;
    const encode = (value: string) => new TextEncoder().encode(value);
    runtime.ztoolkit = {
      getGlobal: (key: string) => {
        if (key === "PathUtils") return { homeDir: "/Users/live-zotero" };
        if (key === "IOUtils") {
          return {
            read: async (path: string) =>
              encode(
                path.endsWith("config.toml")
                  ? 'model_catalog_json = "/runtime/models.json"'
                  : JSON.stringify({
                      models: [
                        {
                          slug: "deepseek-v4-flash:0731",
                          context_window: 1_048_576,
                        },
                      ],
                    }),
              ),
          };
        }
        return undefined;
      },
    };
    try {
      await ensureCodexAppServerModelCapabilities({
        model: "deepseek-v4-flash:0731",
        codexPath: "",
        listModels: async () => ({ data: [] }),
      });
      assert.equal(
        getModelInputTokenLimit("deepseek-v4-flash:0731", {
          apiBase: "",
          protocol: "codex_responses",
          authMode: "codex_app_server",
        }),
        1_048_576,
      );
    } finally {
      runtime.ztoolkit = previousToolkit;
    }
  });

  it("bounds a permanently pending model/list request instead of blocking first send", async function () {
    const catalog = await ensureCodexAppServerModelCapabilities({
      model: "unlisted-native-model",
      codexPath: "/usr/local/bin/codex",
      configPath: null,
      timeoutMs: 20,
      listRequestTimeoutMs: 10,
      listModels: async () => new Promise(() => undefined),
    });
    assert.deepEqual(catalog, { models: [] });
  });

  it("stops native model/list pagination at a hard page limit", async function () {
    let calls = 0;
    const catalog = await loadCodexAppServerModelCatalog({
      timeoutMs: 1_000,
      listModels: async () => {
        calls += 1;
        return {
          data: [{ model: `model-${calls}` }],
          nextCursor: `page-${calls}`,
        };
      },
    });
    assert.equal(calls, 16);
    assert.lengthOf(catalog.models, 16);
  });

  it("reuses the exact native first-use snapshot on later sends", async function () {
    let listCalls = 0;
    const reads: Array<{ path: string; maxBytes: number }> = [];
    const files = new Map<string, string>([
      ["/tmp/config.toml", 'model_catalog_json = "/tmp/models.json"'],
      [
        "/tmp/models.json",
        JSON.stringify({
          models: [{ slug: "third-party/exact", context_window: 900_000 }],
        }),
      ],
    ]);
    const params = {
      model: "third-party/exact",
      codexPath: "/usr/local/bin/codex",
      configPath: "/tmp/config.toml",
      readTextFile: async (path: string, maxBytes: number) => {
        reads.push({ path, maxBytes });
        return files.get(path) || "";
      },
      listModels: async () => {
        listCalls += 1;
        return { data: [] };
      },
    };
    await ensureCodexAppServerModelCapabilities(params);
    await ensureCodexAppServerModelCapabilities(params);
    assert.equal(listCalls, 1);
    assert.deepEqual(reads, [
      { path: "/tmp/config.toml", maxBytes: 64 * 1024 },
      { path: "/tmp/models.json", maxBytes: 2 * 1024 * 1024 },
    ]);
  });

  it("merges a partial refresh without erasing previously registered exact limits", async function () {
    const nativeIdentity = {
      model: "third-party/original",
      codexPath: "/usr/local/bin/codex",
      configPath: null,
    };
    await loadCodexAppServerModelCapabilities({
      ...nativeIdentity,
      catalog: {
        models: [
          {
            id: "original",
            model: "third-party/original",
            displayName: "Original",
            description: "",
            hidden: false,
            supportedReasoningEfforts: [],
            contextWindowTokens: 900_000,
          },
        ],
      },
    });
    await loadCodexAppServerModelCapabilities({
      ...nativeIdentity,
      configPath: "/missing/config.toml",
      readTextFile: async () => {
        throw new Error("local catalog disappeared");
      },
      catalog: {
        models: [
          {
            id: "partial",
            model: "third-party/partial",
            displayName: "Partial",
            description: "",
            hidden: false,
            supportedReasoningEfforts: [],
            contextWindowTokens: 777_000,
          },
        ],
      },
    });
    const identity = {
      apiBase: "/usr/local/bin/codex",
      protocol: "codex_responses",
      authMode: "codex_app_server",
    } as const;
    assert.equal(
      getModelInputTokenLimit("third-party/original", identity),
      900_000,
    );
    assert.equal(
      getModelInputTokenLimit("third-party/partial", identity),
      777_000,
    );
  });

  it("preserves exact opaque Codex hybrid model ids and their catalog limits", function () {
    const models = parseCodexModelCatalogContextWindows(
      JSON.stringify({
        models: [
          { slug: "deepseek-v4-flash:0731", context_window: 1_048_576 },
          { slug: "glm-5.2", context_window: 999_424 },
          {
            slug: "opencode-go/deepseek-v4-flash[1m]",
            context_window: 1_048_576,
          },
          {
            slug: "opencode-go/kimi-k3[1m]",
            context_window: 1_048_576,
          },
          { slug: "bytedance/kimi-k3", context_window: 1_048_576 },
        ],
      }),
    );

    assert.deepEqual(
      models.map((model) => [model.id, model.limits?.inputTokens]),
      [
        ["deepseek-v4-flash:0731", 1_048_576],
        ["glm-5.2", 999_424],
        ["opencode-go/deepseek-v4-flash[1m]", 1_048_576],
        ["opencode-go/kimi-k3[1m]", 1_048_576],
        ["bytedance/kimi-k3", 1_048_576],
      ],
    );
  });

  it("keeps native sends on a safe fallback when both catalogs are unavailable", async function () {
    const catalog = await ensureCodexAppServerModelCapabilities({
      model: "unlisted-native-model",
      codexPath: "/usr/local/bin/codex",
      configPath: "/missing/config.toml",
      readTextFile: async () => {
        throw new Error("not found");
      },
      listModels: async () => {
        throw new Error("app-server unavailable");
      },
    });
    assert.deepEqual(catalog, { models: [] });
    assert.equal(
      getModelInputTokenLimit("unlisted-native-model", {
        apiBase: "/usr/local/bin/codex",
        protocol: "codex_responses",
        authMode: "codex_app_server",
      }),
      128_000,
    );
  });

  it("uses the selected catalog model's advertised reasoning efforts", function () {
    const choices = getCodexAppServerReasoningChoices({
      models: [
        {
          id: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          description: "",
          hidden: false,
          supportedReasoningEfforts: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "ultra",
            "ULTRA",
          ],
          defaultReasoningEffort: "low",
        },
      ],
      selectedModel: "GPT-5.6-SOL",
    });

    assert.deepEqual(choices, [
      { value: "auto", label: "Auto" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "XHigh" },
      { value: "max", label: "Max" },
      { value: "ultra", label: "Ultra" },
    ]);
  });

  it("falls back to legacy reasoning efforts when the model is not cataloged", function () {
    assert.deepEqual(
      getCodexAppServerReasoningChoices({
        models: [],
        selectedModel: "gpt-custom",
      }),
      [
        { value: "auto", label: "Auto" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "XHigh" },
      ],
    );
  });

  it("preserves future wire values and reconciles stale selections", function () {
    const solChoices = getCodexAppServerReasoningChoices({
      models: [
        {
          id: "future",
          model: "future",
          displayName: "Future",
          description: "",
          hidden: false,
          supportedReasoningEfforts: ["very-high", "ultra"],
        },
      ],
      selectedModel: "future",
    });
    const lunaChoices = getCodexAppServerReasoningChoices({
      models: [
        {
          id: "luna",
          model: "luna",
          displayName: "Luna",
          description: "",
          hidden: false,
          supportedReasoningEfforts: ["max"],
        },
      ],
      selectedModel: "luna",
    });

    assert.deepEqual(solChoices[1], {
      value: "very-high",
      label: "Very High",
    });
    assert.equal(
      reconcileCodexAppServerReasoningMode("ULTRA", solChoices),
      "ultra",
    );
    assert.equal(
      reconcileCodexAppServerReasoningMode("ultra", lunaChoices),
      "auto",
    );
    assert.equal(reconcileCodexAppServerReasoningMode("", solChoices), "auto");
  });

  it("preserves the selected reasoning effort until a catalog loads successfully", function () {
    const fallbackChoices = getCodexAppServerReasoningChoices({
      models: [],
      selectedModel: "future",
    });

    const unavailable = resolveCodexAppServerReasoningSelection({
      mode: "ultra",
      choices: fallbackChoices,
      catalogReady: false,
    });
    assert.equal(unavailable.mode, "ultra");
    assert.include(
      unavailable.choices.map((choice) => choice.value),
      "ultra",
    );

    const ready = resolveCodexAppServerReasoningSelection({
      mode: "ultra",
      choices: fallbackChoices,
      catalogReady: true,
    });
    assert.equal(ready.mode, "auto");
    assert.notInclude(
      ready.choices.map((choice) => choice.value),
      "ultra",
    );
  });
});
