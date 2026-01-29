import { config } from "../../package.json";

type PrefKey = "apiBase" | "apiKey" | "model" | "systemPrompt";

const pref = (key: PrefKey) => `${config.prefsPrefix}.${key}`;

const getPref = (key: PrefKey): string => {
  const value = Zotero.Prefs.get(pref(key), true);
  return typeof value === "string" ? value : "";
};

const setPref = (key: PrefKey, value: string) =>
  Zotero.Prefs.set(pref(key), value, true);

export async function registerPrefsScripts(_window: Window) {
  const doc = _window.document;

  // Wait a bit for DOM to be ready
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Populate fields with saved values
  const apiBaseInput = doc.querySelector(
    `#${config.addonRef}-api-base`,
  ) as HTMLInputElement | null;
  const apiKeyInput = doc.querySelector(
    `#${config.addonRef}-api-key`,
  ) as HTMLInputElement | null;
  const modelInput = doc.querySelector(
    `#${config.addonRef}-model`,
  ) as HTMLInputElement | null;
  const systemPromptInput = doc.querySelector(
    `#${config.addonRef}-system-prompt`,
  ) as HTMLTextAreaElement | null;
  const testButton = doc.querySelector(
    `#${config.addonRef}-test-button`,
  ) as HTMLButtonElement | null;
  const testStatus = doc.querySelector(
    `#${config.addonRef}-test-status`,
  ) as HTMLElement | null;

  // Set initial values
  if (apiBaseInput) {
    apiBaseInput.value = getPref("apiBase") || "";
    apiBaseInput.addEventListener("input", () => {
      setPref("apiBase", apiBaseInput.value);
    });
  }

  if (apiKeyInput) {
    apiKeyInput.value = getPref("apiKey") || "";
    apiKeyInput.addEventListener("input", () => {
      setPref("apiKey", apiKeyInput.value);
    });
  }

  if (modelInput) {
    modelInput.value = getPref("model") || "gpt-4o-mini";
    modelInput.addEventListener("input", () => {
      setPref("model", modelInput.value);
    });
  }

  if (systemPromptInput) {
    systemPromptInput.value = getPref("systemPrompt") || "";
    systemPromptInput.addEventListener("input", () => {
      setPref("systemPrompt", systemPromptInput.value);
    });
  }

  // Test connection button
  if (testButton && testStatus) {
    const runTest = async () => {
      testStatus.textContent = "Testing...";
      testStatus.style.color = "#666";

      try {
        const base = (apiBaseInput?.value || "").trim().replace(/\/$/, "");
        const apiKey = (apiKeyInput?.value || "").trim();
        const model = (modelInput?.value || "gpt-4o-mini").trim();

        if (!base) {
          throw new Error("API Base URL is required");
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        // Test with a simple chat request
        const testPayload = {
          model: model,
          messages: [{ role: "user", content: "Say OK" }],
          max_tokens: 5,
        };

        const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
        const response = await fetchFn(`${base}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(testPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP ${response.status}: ${errorText.slice(0, 100)}`,
          );
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const reply = data?.choices?.[0]?.message?.content || "OK";

        testStatus.textContent = `Success! Model says: "${reply.slice(0, 30)}"`;
        testStatus.style.color = "green";
      } catch (error) {
        testStatus.textContent = `Failed: ${(error as Error).message}`;
        testStatus.style.color = "red";
      }
    };

    testButton.addEventListener("click", runTest);
    // Also support XUL command event
    testButton.addEventListener("command", runTest);
  }
}
