import { config } from "../../package.json";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatParams = {
  prompt: string;
  context?: string;
  history?: ChatMessage[];
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

// Note: Streaming support can be added in the future if needed
// The current implementation uses non-streaming requests for simplicity
