import type { RuntimeModelEntry } from "../utils/modelProviders";
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "../utils/llmDefaults";
import { CODEX_REASONING_OPTIONS } from "./constants";
import { listCodexAppServerModels } from "./nativeClient";
import {
  mergeDiscoveredModelCatalogForIdentity,
  type DiscoveredModel,
  type ModelCapabilityIdentity,
} from "../modelCapabilities";

const DEFAULT_MODEL_LIST_LIMIT = 100;
const CODEX_APP_SERVER_GROUP_ID = "codex_app_server";
const CODEX_APP_SERVER_PROVIDER_LABEL = "Codex";
const MAX_CATALOG_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_WINDOW_TOKENS = 100_000_000;
const MAX_MODEL_LIST_PAGES = 16;
const DEFAULT_CATALOG_TIMEOUT_MS = 1_500;
const DEFAULT_LIST_REQUEST_TIMEOUT_MS = 750;
const DEFAULT_LOCAL_CATALOG_READ_TIMEOUT_MS = 300;

export type CodexAppServerModelCatalogEntry = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
};

export type CodexAppServerModelCatalog = {
  models: CodexAppServerModelCatalogEntry[];
};

export type CodexAppServerReasoningChoice = {
  value: string;
  label: string;
};

export type ListCodexAppServerModelsParams = {
  codexPath?: string;
  includeHidden?: boolean;
  cursor?: string;
  limit?: number;
  processKey?: string;
};

export type ListCodexAppServerModelsFn = (
  params: ListCodexAppServerModelsParams,
) => Promise<unknown>;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeContextWindow(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_CONTEXT_WINDOW_TOKENS
    ? value
    : undefined;
}

function normalizeReasoningEfforts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const efforts: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const effort = entry.trim();
      if (effort) efforts.push(effort);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const effort = normalizeString(
      (entry as Record<string, unknown>).reasoningEffort,
    );
    if (effort) efforts.push(effort);
  }
  return efforts;
}

function normalizeCatalogModel(
  value: unknown,
): CodexAppServerModelCatalogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const model = normalizeString(record.model);
  if (!model) return null;
  const displayName = normalizeString(record.displayName) || model;
  const id = normalizeString(record.id) || model;
  const defaultReasoningEffort = normalizeString(record.defaultReasoningEffort);
  const contextWindowTokens = normalizeContextWindow(
    record.context_window ?? record.contextWindow,
  );
  const maxContextWindowTokens = normalizeContextWindow(
    record.max_context_window ?? record.maxContextWindow,
  );
  return {
    id,
    model,
    displayName,
    description: normalizeString(record.description),
    hidden: record.hidden === true,
    supportedReasoningEfforts: normalizeReasoningEfforts(
      record.supportedReasoningEfforts,
    ),
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxContextWindowTokens ? { maxContextWindowTokens } : {}),
  };
}

type TextFileReader = (path: string, maxBytes: number) => Promise<string>;

type PathUtilsLike = { homeDir?: string };
type ServicesLike = {
  env?: { get?: (name: string) => string };
  dirsvc?: {
    get?: (key: string, iface?: unknown) => { path?: string } | undefined;
  };
};
type OSLike = { Constants?: { Path?: { homeDir?: string } } };
type IOUtilsLike = {
  read?: (
    path: string,
    options?: { maxBytes?: number },
  ) => Promise<Uint8Array | ArrayBuffer>;
};

function getToolkitGlobal<T>(name: string): T | undefined {
  const toolkit = (
    globalThis as { ztoolkit?: { getGlobal?: (key: string) => unknown } }
  ).ztoolkit;
  return toolkit?.getGlobal?.(name) as T | undefined;
}

function getNsIFile(): unknown {
  const ci = (globalThis as { Ci?: { nsIFile?: unknown } }).Ci;
  if (ci?.nsIFile) return ci.nsIFile;
  return (
    globalThis as {
      Components?: { interfaces?: { nsIFile?: unknown } };
    }
  ).Components?.interfaces?.nsIFile;
}

function decodeTextFile(data: Uint8Array | ArrayBuffer): string {
  return new TextDecoder().decode(
    data instanceof Uint8Array ? data : new Uint8Array(data),
  );
}

function decodeBoundedTextFile(
  data: Uint8Array | ArrayBuffer,
  maxBytes: number,
): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > maxBytes) {
    throw new Error("Local catalog file exceeds the allowed size");
  }
  return decodeTextFile(bytes);
}

function isBoundedText(value: string, maxBytes: number): boolean {
  return new TextEncoder().encode(value).byteLength <= maxBytes;
}

async function readTextFile(path: string, maxBytes: number): Promise<string> {
  const io =
    (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils ||
    getToolkitGlobal<IOUtilsLike>("IOUtils");
  if (io?.read) {
    return decodeBoundedTextFile(
      await io.read(path, { maxBytes: maxBytes + 1 }),
      maxBytes,
    );
  }
  const os =
    (globalThis as unknown as {
      OS?: {
        File?: {
          stat?: (path: string) => Promise<{ size?: number }>;
          read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
        };
      };
    }).OS ||
    getToolkitGlobal<{
      File?: {
        stat?: (path: string) => Promise<{ size?: number }>;
        read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
      };
    }>("OS");
  if (os?.File?.read) {
    const stat = await os.File.stat?.(path);
    if (Number(stat?.size) > maxBytes) {
      throw new Error("Local catalog file exceeds the allowed size");
    }
    return decodeBoundedTextFile(await os.File.read(path), maxBytes);
  }
  throw new Error("No local text-file reader is available");
}

function getCodexHomeEnvironmentValue(): string {
  const services =
    (globalThis as unknown as { Services?: ServicesLike }).Services ||
    getToolkitGlobal<ServicesLike>("Services");
  const fromServices = services?.env?.get?.("CODEX_HOME");
  if (typeof fromServices === "string" && fromServices.trim()) {
    return fromServices.trim();
  }
  const process = (
    globalThis as unknown as {
      process?: { env?: { CODEX_HOME?: string } };
    }
  ).process;
  return typeof process?.env?.CODEX_HOME === "string"
    ? process.env.CODEX_HOME.trim()
    : "";
}

export function resolveCodexConfigPath(
  params: {
    codexHome?: string;
    homeDir?: string;
  } = {},
): string | null {
  const codexHome = (params.codexHome || "").trim();
  if (codexHome) return `${codexHome}/config.toml`;
  const homeDir = (params.homeDir || "").trim();
  return homeDir ? `${homeDir}/.codex/config.toml` : null;
}

function getDefaultCodexConfigPath(): string | null {
  const pathUtils =
    (globalThis as unknown as { PathUtils?: PathUtilsLike }).PathUtils ||
    getToolkitGlobal<PathUtilsLike>("PathUtils");
  const os =
    (globalThis as unknown as { OS?: OSLike }).OS ||
    getToolkitGlobal<OSLike>("OS");
  const services =
    (globalThis as unknown as { Services?: ServicesLike }).Services ||
    getToolkitGlobal<ServicesLike>("Services");
  return resolveCodexConfigPath({
    codexHome: getCodexHomeEnvironmentValue(),
    homeDir:
      pathUtils?.homeDir ||
      os?.Constants?.Path?.homeDir ||
      services?.dirsvc?.get?.("Home", getNsIFile())?.path,
  });
}

/** Reads only the catalog path directive, never the rest of Codex's config. */
export function parseCodexModelCatalogPathDirective(
  configText: string,
): string | null {
  let rootScope = true;
  for (const line of configText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\](?:\s*#.*)?$/.test(trimmed)) {
      rootScope = false;
      continue;
    }
    if (!rootScope) continue;
    const match = line.match(
      /^\s*model_catalog_json\s*=\s*"([^"\\\r\n]+)"\s*(?:#.*)?$/,
    );
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Whitelist parser for the local Codex model catalog. The full catalog has
 * more runtime data, but token accounting needs only exact slugs and their
 * current context limits.
 */
export function parseCodexModelCatalogContextWindows(
  catalogText: string,
): DiscoveredModel[] {
  if (catalogText.length > MAX_CATALOG_FILE_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(catalogText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const rawModels = (parsed as { models?: unknown }).models;
  if (!Array.isArray(rawModels)) return [];
  const models: DiscoveredModel[] = [];
  for (const raw of rawModels) {
    if (models.length >= 4096 || !raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = normalizeString(row.slug);
    if (!id || id.length > 256) continue;
    const contextWindowTokens = normalizeContextWindow(row.context_window);
    const maxContextWindowTokens = normalizeContextWindow(
      row.max_context_window,
    );
    const activeLimit = contextWindowTokens || maxContextWindowTokens;
    if (!activeLimit) continue;
    models.push({
      id,
      limits: {
        contextWindowTokens: activeLimit,
        inputTokens: activeLimit,
      },
      source: "live",
    });
  }
  return models;
}

export function buildCodexAppServerCapabilityIdentity(params: {
  model: string;
  codexPath?: string;
}): ModelCapabilityIdentity {
  return {
    // `customized` is the native runtime's provider preset for a local binary.
    provider: "customized",
    model: params.model,
    apiBase: params.codexPath || "",
    protocol: "codex_responses",
    authMode: "codex_app_server",
  };
}

function mergeCapabilityModels(params: {
  configuredModels: DiscoveredModel[];
  appServerModels: CodexAppServerModelCatalogEntry[];
}): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();
  for (const model of params.configuredModels) byId.set(model.id, model);
  for (const model of params.appServerModels) {
    const limit = model.contextWindowTokens || model.maxContextWindowTokens;
    if (!limit) continue;
    byId.set(model.model, {
      id: model.model,
      limits: { contextWindowTokens: limit, inputTokens: limit },
      source: "live",
    });
  }
  return [...byId.values()];
}

export async function loadCodexAppServerModelCapabilities(params: {
  model: string;
  codexPath?: string;
  catalog?: CodexAppServerModelCatalog;
  configPath?: string | null;
  readTextFile?: TextFileReader;
  readTimeoutMs?: number;
}): Promise<void> {
  const read = params.readTextFile || readTextFile;
  const readTimeoutMs = Math.max(
    1,
    Math.floor(params.readTimeoutMs ?? DEFAULT_LOCAL_CATALOG_READ_TIMEOUT_MS),
  );
  const configPath = params.configPath ?? getDefaultCodexConfigPath();
  let configuredModels: DiscoveredModel[] = [];
  if (configPath) {
    try {
      const configRead = await withTimeout(
        read(configPath, MAX_CONFIG_FILE_BYTES),
        readTimeoutMs,
      );
      if (configRead.timedOut || !configRead.value) throw new Error("timeout");
      if (!isBoundedText(configRead.value, MAX_CONFIG_FILE_BYTES)) {
        throw new Error("Local config file exceeds the allowed size");
      }
      const catalogPath = parseCodexModelCatalogPathDirective(configRead.value);
      if (catalogPath) {
        const catalogRead = await withTimeout(
          read(catalogPath, MAX_CATALOG_FILE_BYTES),
          readTimeoutMs,
        );
        if (catalogRead.timedOut || !catalogRead.value)
          throw new Error("timeout");
        if (!isBoundedText(catalogRead.value, MAX_CATALOG_FILE_BYTES)) {
          throw new Error("Local catalog file exceeds the allowed size");
        }
        configuredModels = parseCodexModelCatalogContextWindows(
          catalogRead.value,
        );
      }
    } catch {
      // Local configuration is optional; app-server metadata remains usable.
    }
  }
  const identity = buildCodexAppServerCapabilityIdentity({
    model: params.model,
    codexPath: params.codexPath,
  });
  const models = mergeCapabilityModels({
    configuredModels,
    appServerModels: params.catalog?.models || [],
  });
  // A transient config/model-list failure must not erase a valid snapshot
  // obtained earlier in the same Zotero session.
  if (models.length) {
    mergeDiscoveredModelCatalogForIdentity(identity, models);
  }
}

function normalizeCatalogPage(value: unknown): {
  models: CodexAppServerModelCatalogEntry[];
  nextCursor?: string;
} {
  if (!value || typeof value !== "object") {
    return { models: [] };
  }
  const record = value as Record<string, unknown>;
  const rawData = Array.isArray(record.data) ? record.data : [];
  const models = rawData
    .map((entry) => normalizeCatalogModel(entry))
    .filter((entry): entry is CodexAppServerModelCatalogEntry =>
      Boolean(entry),
    );
  const nextCursor = normalizeString(record.nextCursor);
  return {
    models,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: boolean; value?: T }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task.then((value) => ({ timedOut: false, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function loadCodexAppServerModelCatalog(params: {
  codexPath?: string;
  includeHidden?: boolean;
  limit?: number;
  processKey?: string;
  listModels?: ListCodexAppServerModelsFn;
  /** Total bounded wait for paging; metadata must not delay a real send. */
  timeoutMs?: number;
  /** Test-only narrowing for the bounded page request. */
  listRequestTimeoutMs?: number;
}): Promise<CodexAppServerModelCatalog> {
  const listModels = params.listModels || listCodexAppServerModels;
  const includeHidden = params.includeHidden === true;
  const limit = params.limit ?? DEFAULT_MODEL_LIST_LIMIT;
  const models: CodexAppServerModelCatalogEntry[] = [];
  const seenModels = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  const totalTimeoutMs = Math.max(
    1,
    Math.floor(params.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS),
  );
  const requestTimeoutMs = Math.max(
    1,
    Math.floor(params.listRequestTimeoutMs ?? DEFAULT_LIST_REQUEST_TIMEOUT_MS),
  );
  const deadline = Date.now() + totalTimeoutMs;

  for (let pageCount = 0; pageCount < MAX_MODEL_LIST_PAGES; pageCount++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const response = await withTimeout(
      listModels({
        codexPath: params.codexPath,
        includeHidden,
        limit,
        cursor,
        processKey: params.processKey,
      }),
      Math.min(requestTimeoutMs, remainingMs),
    );
    if (response.timedOut) break;
    const page = normalizeCatalogPage(response.value);
    for (const model of page.models) {
      if (!includeHidden && model.hidden) continue;
      const key = model.model.toLowerCase();
      if (seenModels.has(key)) continue;
      seenModels.add(key);
      models.push(model);
    }
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return { models };
}

/**
 * Native app-server models have no HTTP `/models` endpoint. Load their menu
 * catalog and the local `model_catalog_json` metadata as one bounded first-use
 * step, before request planning asks the capability registry for a limit.
 */
export async function ensureCodexAppServerModelCapabilities(params: {
  model: string;
  codexPath?: string;
  includeHidden?: boolean;
  limit?: number;
  processKey?: string;
  listModels?: ListCodexAppServerModelsFn;
  configPath?: string | null;
  readTextFile?: TextFileReader;
  timeoutMs?: number;
  listRequestTimeoutMs?: number;
  readTimeoutMs?: number;
  /** Bypass a bounded send-time snapshot when an interactive surface needs a fresh catalog. */
  forceRefresh?: boolean;
}): Promise<CodexAppServerModelCatalog> {
  const identity = buildCodexAppServerCapabilityIdentity({
    model: params.model,
    codexPath: params.codexPath,
  });
  const key = [
    identity.provider,
    identity.apiBase,
    identity.protocol,
    identity.authMode,
  ]
    .map((value) => (value || "").trim().toLowerCase())
    .join("\u0000");
  if (!params.forceRefresh) {
    const cached = nativeCapabilityCatalogSnapshots.get(key);
    if (cached) return cached;
    const running = nativeCapabilityCatalogTasks.get(key);
    if (running) return running;
  }

  const task = (async () => {
    let catalog: CodexAppServerModelCatalog = { models: [] };
    try {
      catalog = await loadCodexAppServerModelCatalog({
        codexPath: params.codexPath,
        includeHidden: params.includeHidden,
        limit: params.limit,
        processKey: params.processKey,
        listModels: params.listModels,
        timeoutMs: params.timeoutMs,
        listRequestTimeoutMs: params.listRequestTimeoutMs,
      });
    } catch {
      // Capability metadata must never prevent the real native request from
      // reaching app-server. Local catalog data and existing fallbacks remain.
    }
    await loadCodexAppServerModelCapabilities({
      model: params.model,
      codexPath: params.codexPath,
      catalog,
      configPath: params.configPath,
      readTextFile: params.readTextFile,
      readTimeoutMs: params.readTimeoutMs,
    });
    return catalog;
  })();
  nativeCapabilityCatalogTasks.set(key, task);
  try {
    const catalog = await task;
    if (nativeCapabilityCatalogTasks.get(key) === task) {
      const previous = nativeCapabilityCatalogSnapshots.get(key);
      // A transient empty refresh must not erase a previously working menu.
      if (catalog.models.length || !previous) {
        nativeCapabilityCatalogSnapshots.set(key, catalog);
      }
    }
    return catalog;
  } finally {
    if (nativeCapabilityCatalogTasks.get(key) === task) {
      nativeCapabilityCatalogTasks.delete(key);
    }
  }
}

const nativeCapabilityCatalogTasks = new Map<
  string,
  Promise<CodexAppServerModelCatalog>
>();
const nativeCapabilityCatalogSnapshots = new Map<
  string,
  CodexAppServerModelCatalog
>();

export function resetCodexAppServerModelCatalogStateForTests(): void {
  nativeCapabilityCatalogTasks.clear();
  nativeCapabilityCatalogSnapshots.clear();
}

export function formatCodexAppServerReasoningLabel(value: string): string {
  const normalized = value.trim();
  if (normalized.toLowerCase() === "xhigh") return "XHigh";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getCodexAppServerReasoningChoices(params: {
  models: CodexAppServerModelCatalogEntry[];
  selectedModel: string;
}): CodexAppServerReasoningChoice[] {
  const selectedModel = params.selectedModel.trim().toLowerCase();
  const catalogModel = params.models.find(
    (model) => model.model.toLowerCase() === selectedModel,
  );
  const efforts = catalogModel
    ? catalogModel.supportedReasoningEfforts
    : CODEX_REASONING_OPTIONS;
  const choices: CodexAppServerReasoningChoice[] = [
    { value: "auto", label: "Auto" },
  ];
  const seen = new Set<string>(["auto"]);

  for (const effort of efforts) {
    const value = effort.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    choices.push({
      value,
      label: formatCodexAppServerReasoningLabel(value),
    });
  }

  return choices;
}

export function reconcileCodexAppServerReasoningMode(
  mode: string,
  choices: CodexAppServerReasoningChoice[],
): string {
  const normalized = mode.trim();
  if (!normalized || normalized.toLowerCase() === "auto") return "auto";
  return (
    choices.find(
      (choice) => choice.value.toLowerCase() === normalized.toLowerCase(),
    )?.value || "auto"
  );
}

export function resolveCodexAppServerReasoningSelection(params: {
  mode: string;
  choices: CodexAppServerReasoningChoice[];
  catalogReady: boolean;
}): {
  mode: string;
  choices: CodexAppServerReasoningChoice[];
} {
  if (params.catalogReady) {
    return {
      mode: reconcileCodexAppServerReasoningMode(params.mode, params.choices),
      choices: params.choices,
    };
  }

  const normalizedMode = params.mode.trim();
  if (!normalizedMode || normalizedMode.toLowerCase() === "auto") {
    return { mode: "auto", choices: params.choices };
  }
  const existingChoice = params.choices.find(
    (choice) => choice.value.toLowerCase() === normalizedMode.toLowerCase(),
  );
  if (existingChoice) {
    return { mode: existingChoice.value, choices: params.choices };
  }
  return {
    mode: normalizedMode,
    choices: [
      ...params.choices,
      {
        value: normalizedMode,
        label: formatCodexAppServerReasoningLabel(normalizedMode),
      },
    ],
  };
}

function createRuntimeModelEntry(params: {
  model: string;
  displayModelLabel: string;
  codexPath?: string;
}): RuntimeModelEntry {
  return {
    entryId: `${CODEX_APP_SERVER_GROUP_ID}::${params.model}`,
    groupId: CODEX_APP_SERVER_GROUP_ID,
    model: params.model,
    apiBase: params.codexPath || "",
    apiKey: "",
    authMode: "codex_app_server",
    providerProtocol: "codex_responses",
    providerLabel: CODEX_APP_SERVER_PROVIDER_LABEL,
    providerOrder: -1,
    displayModelLabel: params.displayModelLabel,
    advanced: {
      temperature: DEFAULT_TEMPERATURE,
      maxTokens: DEFAULT_MAX_TOKENS,
    },
  };
}

export function buildCodexRuntimeModelEntries(params: {
  models: CodexAppServerModelCatalogEntry[];
  selectedModel: string;
  codexPath?: string;
}): RuntimeModelEntry[] {
  const selectedModel = params.selectedModel.trim();
  const entries: RuntimeModelEntry[] = [];
  const seenModels = new Set<string>();

  if (selectedModel) {
    const hasSelectedModel = params.models.some(
      (model) => model.model.toLowerCase() === selectedModel.toLowerCase(),
    );
    if (!hasSelectedModel) {
      entries.push(
        createRuntimeModelEntry({
          model: selectedModel,
          displayModelLabel: selectedModel,
          codexPath: params.codexPath,
        }),
      );
      seenModels.add(selectedModel.toLowerCase());
    }
  }

  for (const model of params.models) {
    const key = model.model.toLowerCase();
    if (seenModels.has(key)) continue;
    seenModels.add(key);
    entries.push(
      createRuntimeModelEntry({
        model: model.model,
        displayModelLabel: model.displayName || model.model,
        codexPath: params.codexPath,
      }),
    );
  }

  return entries;
}
