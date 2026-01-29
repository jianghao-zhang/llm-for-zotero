import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";

const PANE_ID = "llm-context-panel";

// Simple conversation storage
interface Message {
  role: "user" | "assistant";
  text: string;
}

const chatHistory = new Map<number, Message[]>();
const pdfTextCache = new Map<number, string>();

// Max PDF text length (reduced to speed up API calls)
const MAX_PDF_LENGTH = 8000;

export function registerLLMStyles(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  if (doc.getElementById(`${config.addonRef}-styles`)) return;
  const link = doc.createElement("link") as HTMLLinkElement;
  link.id = `${config.addonRef}-styles`;
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = `chrome://${config.addonRef}/content/zoteroPane.css`;
  doc.documentElement?.appendChild(link);
}

export function registerReaderContextPanel() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("llm-panel-head"),
      icon: "chrome://zotero/skin/16/universal/note.svg",
    },
    sidenav: {
      l10nID: getLocaleID("llm-panel-sidenav-tooltip"),
      icon: "chrome://zotero/skin/20/universal/note.svg",
    },
    onItemChange: ({ setEnabled, tabType }) => {
      setEnabled(tabType === "reader" || tabType === "library");
      return true;
    },
    onRender: ({ body, item }) => {
      buildUI(body, item);
    },
    onAsyncRender: async ({ body, item }) => {
      if (item) {
        await cachePDFText(item);
      }
      setupHandlers(body, item);
      refreshChat(body, item);
    },
  });
}

function buildUI(body: Element, item?: Zotero.Item | null) {
  body.textContent = "";
  const doc = body.ownerDocument!;

  const container = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  container.id = "llm-main";
  container.style.cssText =
    "display:flex; flex-direction:column; height:100%; padding:12px; box-sizing:border-box; font-family:system-ui,-apple-system,sans-serif;";

  // Title
  const header = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  header.style.cssText =
    "font-size:18px; font-weight:700; margin-bottom:12px; color:#222;";
  header.textContent = "LLM Assistant";
  container.appendChild(header);

  // Chat display area (big box)
  const chatBox = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  chatBox.id = "llm-chat-box";
  chatBox.style.cssText =
    "flex:1; overflow-y:auto; border:2px solid #ddd; border-radius:10px; padding:12px; background:#fafafa; margin-bottom:12px; min-height:150px;";
  chatBox.innerHTML = item
    ? '<div style="color:#999;text-align:center;padding:30px;">Type a question below to start</div>'
    : '<div style="color:#999;text-align:center;padding:30px;">Open a PDF to chat</div>';
  container.appendChild(chatBox);

  // Input area (below chat box)
  const inputRow = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  inputRow.style.cssText = "display:flex; gap:10px;";

  const inputBox = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "input",
  ) as HTMLInputElement;
  inputBox.id = "llm-input";
  inputBox.type = "text";
  inputBox.placeholder = item ? "Type your question..." : "Open a PDF first";
  inputBox.disabled = !item;
  inputBox.style.cssText =
    "flex:1; padding:12px; font-size:14px; border:2px solid #bbb; border-radius:8px; outline:none;";
  inputRow.appendChild(inputBox);

  const sendBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  sendBtn.id = "llm-send";
  sendBtn.textContent = "Send";
  sendBtn.disabled = !item;
  sendBtn.style.cssText =
    "padding:12px 24px; font-size:14px; font-weight:700; background:#007bff; color:#fff; border:none; border-radius:8px; cursor:pointer;";
  inputRow.appendChild(sendBtn);

  container.appendChild(inputRow);

  // Status line
  const statusLine = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  statusLine.id = "llm-status";
  statusLine.style.cssText = "margin-top:8px; font-size:12px; color:#666;";
  statusLine.textContent = item ? "Ready" : "No document";
  container.appendChild(statusLine);

  body.appendChild(container);
}

async function cachePDFText(item: Zotero.Item) {
  if (pdfTextCache.has(item.id)) return;

  try {
    let pdfText = "";

    // Get the main item (parent if this is an attachment)
    const mainItem =
      item.isAttachment() && item.parentID
        ? Zotero.Items.get(item.parentID)
        : item;

    // Build context from metadata
    const title = mainItem?.getField("title") || "";
    const abstract = mainItem?.getField("abstractNote") || "";

    const contextParts: string[] = [];
    if (title) contextParts.push(`Title: ${title}`);
    if (abstract) contextParts.push(`Abstract: ${abstract}`);

    // Try to get PDF text
    let pdfItem: Zotero.Item | null = null;

    if (
      item.isAttachment() &&
      item.attachmentContentType === "application/pdf"
    ) {
      pdfItem = item;
    } else if (mainItem) {
      const attachments = mainItem.getAttachments();
      for (const attId of attachments) {
        const att = Zotero.Items.get(attId);
        if (att && att.attachmentContentType === "application/pdf") {
          pdfItem = att;
          break;
        }
      }
    }

    if (pdfItem) {
      try {
        const result = await Zotero.PDFWorker.getFullText(pdfItem.id);
        if (result && result.text) {
          pdfText = result.text;
          // Limit text to speed up API calls
          if (pdfText.length > MAX_PDF_LENGTH) {
            pdfText =
              pdfText.substring(0, MAX_PDF_LENGTH) +
              "\n\n...[Content truncated for faster processing. Full paper has " +
              result.text.length +
              " characters]";
          }
        }
      } catch (e) {
        ztoolkit.log("PDF text extraction failed:", e);
      }
    }

    if (pdfText) {
      contextParts.push(`\nFull Paper Text:\n${pdfText}`);
    }

    pdfTextCache.set(item.id, contextParts.join("\n\n"));
  } catch (e) {
    ztoolkit.log("Error caching PDF:", e);
    pdfTextCache.set(item.id, "");
  }
}

function setupHandlers(body: Element, item?: Zotero.Item | null) {
  const doc = body.ownerDocument!;
  const inputBox = doc.getElementById("llm-input") as HTMLInputElement | null;
  const sendBtn = doc.getElementById("llm-send") as HTMLButtonElement | null;

  if (!inputBox || !sendBtn) return;

  const doSend = async () => {
    if (!item) return;
    const text = inputBox.value.trim();
    if (!text) return;
    inputBox.value = "";
    await sendQuestion(body, item, text);
  };

  // Click handler
  sendBtn.onclick = (e: Event) => {
    e.preventDefault();
    doSend();
  };

  // Enter key handler
  inputBox.onkeydown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  };
}

async function sendQuestion(
  body: Element,
  item: Zotero.Item,
  question: string,
) {
  const doc = body.ownerDocument!;
  const inputBox = doc.getElementById("llm-input") as HTMLInputElement | null;
  const sendBtn = doc.getElementById("llm-send") as HTMLButtonElement | null;
  const status = doc.getElementById("llm-status") as HTMLElement | null;

  // Disable UI
  if (inputBox) inputBox.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = "Sending to model...";

  // Add user message to history
  if (!chatHistory.has(item.id)) {
    chatHistory.set(item.id, []);
  }
  const history = chatHistory.get(item.id)!;
  history.push({ role: "user", text: question });
  refreshChat(body, item);

  try {
    // Get PDF context
    const pdfContext = pdfTextCache.get(item.id) || "";

    // Get API settings
    const apiBase = (
      (Zotero.Prefs.get(`${config.prefsPrefix}.apiBase`, true) as string) || ""
    ).replace(/\/$/, "");
    const apiKey =
      (Zotero.Prefs.get(`${config.prefsPrefix}.apiKey`, true) as string) || "";
    const model =
      (Zotero.Prefs.get(`${config.prefsPrefix}.model`, true) as string) ||
      "gpt-4o-mini";

    if (!apiBase) {
      throw new Error("Please set API Base URL in Zotero settings");
    }

    // Build messages for API
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful research assistant. Answer questions about the paper based on the provided content. Be concise and accurate.",
      },
      {
        role: "system",
        content: `Paper content:\n${pdfContext || "No content available"}`,
      },
    ];

    // Add conversation history
    for (const msg of history.slice(0, -1)) {
      messages.push({
        role: msg.role,
        content: msg.text,
      });
    }

    // Add current question
    messages.push({
      role: "user",
      content: question,
    });

    // Make API call
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Update status to show we're waiting
    if (status) {
      status.textContent =
        "Waiting for AI response (this may take a minute)...";
    }

    const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
    const response = await fetchFn(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 100)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer =
      data?.choices?.[0]?.message?.content || "No response from model";

    // Add assistant response
    history.push({ role: "assistant", text: answer });
    refreshChat(body, item);

    if (status) {
      status.textContent = "Ready";
      status.style.color = "#090";
    }
  } catch (err) {
    const errMsg = (err as Error).message || "Unknown error";
    history.push({ role: "assistant", text: `Error: ${errMsg}` });
    refreshChat(body, item);

    if (status) {
      status.textContent = `Error: ${errMsg.slice(0, 50)}`;
      status.style.color = "#c00";
    }
  } finally {
    if (inputBox) {
      inputBox.disabled = false;
      inputBox.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}

function refreshChat(body: Element, item?: Zotero.Item | null) {
  const doc = body.ownerDocument!;
  const chatBox = doc.getElementById("llm-chat-box");
  if (!chatBox) return;

  if (!item) {
    chatBox.innerHTML =
      '<div style="color:#999;text-align:center;padding:30px;">Open a PDF to chat</div>';
    return;
  }

  const history = chatHistory.get(item.id) || [];

  if (history.length === 0) {
    chatBox.innerHTML =
      '<div style="color:#999;text-align:center;padding:30px;">Type a question below to start</div>';
    return;
  }

  chatBox.innerHTML = "";

  for (const msg of history) {
    const bubble = doc.createElement("div");
    const isUser = msg.role === "user";

    bubble.style.cssText = `
      margin-bottom: 12px;
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 85%;
      word-wrap: break-word;
      line-height: 1.5;
      ${isUser ? "background:#007bff; color:#fff; margin-left:auto;" : "background:#e9e9e9; color:#222; margin-right:auto;"}
    `;

    if (isUser) {
      bubble.textContent = msg.text;
    } else {
      // Simple markdown: bold, newlines
      const html = msg.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      bubble.innerHTML = html;
    }

    chatBox.appendChild(bubble);
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

export function clearConversation(itemId: number) {
  chatHistory.delete(itemId);
}

export function getConversationHistory(itemId: number): Message[] {
  return chatHistory.get(itemId) || [];
}
