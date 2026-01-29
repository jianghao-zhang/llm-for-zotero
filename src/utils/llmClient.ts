import { config } from "../../package.json";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatParams = {
  prompt: string;
  context?: string;
  history?: ChatMessage[];
  signal?: AbortSignal;
};

const prefKey = (key: string) => `${config.prefsPrefix}.${key}`;

const getPref = (key: string) => Zotero.Prefs.get(prefKey(key), true) as string;

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent research assistant integrated into Zotero. You help users analyze and understand academic papers and documents.

When answering questions:
- Be concise but thorough
- Cite specific parts of the document when relevant
- Use markdown formatting for better readability (headers, lists, bold, code blocks)
- If you don't have enough information to answer, say so clearly
- Provide actionable insights when possible`;

export async function callLLM(params: ChatParams): Promise<string> {
  const apiBase = (getPref("apiBase") || "").replace(/\/$/, "");
  const apiKey = getPref("apiKey") || "";
  const model = getPref("model") || "gpt-4o-mini";
  const customSystemPrompt = getPref("systemPrompt") || "";

  if (!apiBase) throw new Error("API base URL is missing in preferences");

  const systemContent = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemContent,
    },
  ];

  // Add context as a system message if provided
  if (params.context) {
    messages.push({
      role: "system",
      content: `Document Context:\n${params.context}`,
    });
  }

  // Add conversation history if provided
  if (params.history && params.history.length > 0) {
    messages.push(...params.history);
  }

  // Add the current user prompt
  messages.push({
    role: "user",
    content: params.prompt,
  });

  const payload = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 2048,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
  const res = await fetchFn(`${apiBase}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText} - ${text}`);
  }

  const data = (await res.json()) as any;
  const reply =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    JSON.stringify(data);
  return reply;
}

export async function callLLMStream(
  params: ChatParams,
  onDelta: (delta: string) => void,
): Promise<string> {
  const apiBase = (getPref("apiBase") || "").replace(/\/$/, "");
  const apiKey = getPref("apiKey") || "";
  const model = getPref("model") || "gpt-4o-mini";
  const customSystemPrompt = getPref("systemPrompt") || "";

  if (!apiBase) throw new Error("API base URL is missing in preferences");

  const systemContent = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemContent,
    },
  ];

  if (params.context) {
    messages.push({
      role: "system",
      content: `Document Context:\n${params.context}`,
    });
  }

  if (params.history && params.history.length > 0) {
    messages.push(...params.history);
  }

  messages.push({
    role: "user",
    content: params.prompt,
  });

  const payload = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 2048,
    stream: true,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
  const res = await fetchFn(`${apiBase}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText} - ${text}`);
  }

  if (!res.body) {
    return callLLM(params);
  }

  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        return fullText;
      }
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: string };
            message?: { content?: string };
          }>;
        };
        const delta =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.choices?.[0]?.message?.content ??
          "";
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      } catch (err) {
        ztoolkit.log("LLM stream parse error:", err);
      }
    }
  }

  return fullText;
}
