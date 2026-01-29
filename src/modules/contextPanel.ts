import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { callLLMStream, ChatMessage } from "../utils/llmClient";
import { config } from "../../package.json";

const PANE_ID = "llm-context-panel";

// Conversation storage
interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  streaming?: boolean;
}

const chatHistory = new Map<number, Message[]>();
const pdfTextCache = new Map<number, string>();
const pdfSummaryCache = new Map<number, string>();

// Track ongoing requests to allow cancellation
let currentRequestId = 0;
let cancelledRequestId = -1;

// Max PDF text length
const MAX_PDF_LENGTH = 8000;
const MAX_HISTORY_MESSAGES = 12;

let currentAbortController: AbortController | null = null;

const getAbortController = () => {
  const globalAny = ztoolkit.getGlobal("AbortController") as
    | (new () => AbortController)
    | undefined;
  return globalAny || (globalThis as any).AbortController;
};

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
      updateContextUI(body, item);
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
  container.className = "llm-panel";

  // Title row
  const header = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  header.className = "llm-header";

  const headerTop = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  headerTop.className = "llm-header-top";

  const headerInfo = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  headerInfo.className = "llm-header-info";

  const title = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  title.className = "llm-title";
  title.textContent = "LLM Assistant";

  const subtitle = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  subtitle.className = "llm-subtitle";
  subtitle.textContent = "Ask questions about your documents";

  headerInfo.appendChild(title);
  headerInfo.appendChild(subtitle);
  headerTop.appendChild(headerInfo);

  // Clear button
  const clearBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  clearBtn.id = "llm-clear";
  clearBtn.className = "llm-btn-icon";
  clearBtn.textContent = "Clear";
  headerTop.appendChild(clearBtn);
  header.appendChild(headerTop);

  container.appendChild(header);

  // Context section
  const contextSection = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  contextSection.className = "llm-context-section";

  const contextHeader = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  contextHeader.className = "llm-context-header";

  const contextLabel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLSpanElement;
  contextLabel.className = "llm-context-label";
  contextLabel.textContent = "Document";

  const contextStatus = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLSpanElement;
  contextStatus.id = "llm-context-status";
  contextStatus.className = "llm-context-status";
  contextStatus.textContent = item ? "Loading..." : "No document";

  contextHeader.appendChild(contextLabel);
  contextHeader.appendChild(contextStatus);

  const contextBox = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  contextBox.id = "llm-context-box";
  contextBox.className = "llm-context";
  contextBox.textContent = item
    ? "Loading document context..."
    : "Select an item or open a PDF to start";

  contextSection.appendChild(contextHeader);
  contextSection.appendChild(contextBox);
  container.appendChild(contextSection);

  // Quick actions
  const quickActions = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  quickActions.className = "llm-quick-actions";
  const actions = [
    { label: "Summarize", prompt: "Summarize the document." },
    { label: "Key Points", prompt: "List the key points from the document." },
    { label: "Methodology", prompt: "Describe the methodology used." },
    { label: "Limitations", prompt: "What are the limitations?" },
    { label: "Future Work", prompt: "Suggest future work directions." },
  ];

  for (const action of actions) {
    const btn = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    btn.className = "llm-quick-btn";
    btn.type = "button";
    btn.dataset.prompt = action.prompt;
    btn.disabled = !item;

    const label = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLSpanElement;
    label.className = "llm-quick-label";
    label.textContent = action.label;
    btn.appendChild(label);
    quickActions.appendChild(btn);
  }
  container.appendChild(quickActions);

  // Chat display area
  const chatBox = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  chatBox.id = "llm-chat-box";
  chatBox.className = "llm-messages";
  container.appendChild(chatBox);

  // Input area
  const inputSection = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  inputSection.className = "llm-input-section";

  const inputBox = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "textarea",
  ) as HTMLTextAreaElement;
  inputBox.id = "llm-input";
  inputBox.placeholder = item ? "Ask a question about this paper..." : "Open a PDF first";
  inputBox.disabled = !item;
  inputBox.className = "llm-input";
  inputSection.appendChild(inputBox);

  const actionsRow = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  actionsRow.className = "llm-actions";

  const sendBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  sendBtn.id = "llm-send";
  sendBtn.textContent = "Send";
  sendBtn.disabled = !item;
  sendBtn.className = "llm-send-btn";
  actionsRow.appendChild(sendBtn);

  const cancelBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  cancelBtn.id = "llm-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "llm-send-btn llm-cancel-btn";
  cancelBtn.style.display = "none";
  actionsRow.appendChild(cancelBtn);

  const statusLine = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  statusLine.id = "llm-status";
  statusLine.className = "llm-status";
  statusLine.textContent = item ? "Ready" : "Select an item or open a PDF";
  actionsRow.appendChild(statusLine);

  inputSection.appendChild(actionsRow);
  container.appendChild(inputSection);

  body.appendChild(container);
}

async function cachePDFText(item: Zotero.Item) {
  if (pdfTextCache.has(item.id)) return;

  try {
    let pdfText = "";
    const mainItem =
      item.isAttachment() && item.parentID
        ? Zotero.Items.get(item.parentID)
        : item;

    const title = mainItem?.getField("title") || "";
    const abstract = mainItem?.getField("abstractNote") || "";

    const contextParts: string[] = [];
    if (title) contextParts.push(`Title: ${title}`);
    if (abstract) contextParts.push(`Abstract: ${abstract}`);

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
          if (pdfText.length > MAX_PDF_LENGTH) {
            pdfText =
              pdfText.substring(0, MAX_PDF_LENGTH) +
              "\n\n...[Truncated. Full: " +
              result.text.length +
              " chars]";
          }
        }
      } catch (e) {
        ztoolkit.log("PDF extraction failed:", e);
      }
    }

    if (pdfText) {
      contextParts.push(`\nPaper Text:\n${pdfText}`);
    }

    pdfTextCache.set(item.id, contextParts.join("\n\n"));

    const summaryParts: string[] = [];
    if (title) summaryParts.push(title);
    if (abstract) summaryParts.push(abstract);
    if (!title && !abstract) {
      summaryParts.push("No title or abstract found.");
    }
    if (pdfText) {
      summaryParts.push("PDF text loaded.");
    }
    pdfSummaryCache.set(item.id, summaryParts.join("\n\n"));
  } catch (e) {
    ztoolkit.log("Error caching PDF:", e);
    pdfTextCache.set(item.id, "");
    pdfSummaryCache.set(item.id, "Failed to load document context.");
  }
}

function updateContextUI(body: Element, item?: Zotero.Item | null) {
  const contextBox = body.querySelector(
    "#llm-context-box",
  ) as HTMLDivElement | null;
  const contextStatus = body.querySelector(
    "#llm-context-status",
  ) as HTMLSpanElement | null;
  if (!contextBox || !contextStatus) return;

  if (!item) {
    contextStatus.textContent = "No document";
    contextBox.textContent = "Select an item or open a PDF to start.";
    return;
  }

  const summary = pdfSummaryCache.get(item.id);
  contextStatus.textContent = summary ? "Ready" : "Loading...";
  contextBox.textContent = summary || "Loading document context...";
}

function setStatus(
  statusEl: HTMLElement,
  text: string,
  variant: "ready" | "sending" | "error",
) {
  statusEl.textContent = text;
  statusEl.className = `llm-status llm-status-${variant}`;
}

function formatTime(timestamp: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function sanitizeText(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      } else {
        out += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\uFFFD";
      continue;
    }
    out += text[i];
  }
  return out;
}

function setupHandlers(body: Element, item?: Zotero.Item | null) {
  // Use querySelector on body to find elements
  const inputBox = body.querySelector(
    "#llm-input",
  ) as HTMLTextAreaElement | null;
  const sendBtn = body.querySelector("#llm-send") as HTMLButtonElement | null;
  const cancelBtn = body.querySelector(
    "#llm-cancel",
  ) as HTMLButtonElement | null;
  const clearBtn = body.querySelector("#llm-clear") as HTMLButtonElement | null;
  const quickButtons = Array.from(
    body.querySelectorAll(".llm-quick-btn"),
  ) as HTMLButtonElement[];

  if (!inputBox || !sendBtn) {
    ztoolkit.log("LLM: Could not find input or send button");
    return;
  }

  const doSend = async () => {
    if (!item) return;
    const text = inputBox.value.trim();
    if (!text) return;
    inputBox.value = "";
    await sendQuestion(body, item, text);
  };

  // Send button - use addEventListener
  sendBtn.addEventListener("click", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    doSend();
  });

  // Enter key (Shift+Enter for newline)
  inputBox.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" && !ke.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      doSend();
    }
  });

  // Cancel button
  if (cancelBtn) {
    cancelBtn.addEventListener("click", (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentAbortController) {
        currentAbortController.abort();
      }
      cancelledRequestId = currentRequestId;
      const status = body.querySelector("#llm-status") as HTMLElement | null;
      if (status) setStatus(status, "Cancelled", "ready");
      // Re-enable UI
      if (inputBox) inputBox.disabled = false;
      if (sendBtn) {
        sendBtn.style.display = "";
        sendBtn.disabled = false;
      }
      cancelBtn.style.display = "none";
    });
  }

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener("click", (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (item) {
        chatHistory.delete(item.id);
        refreshChat(body, item);
        const status = body.querySelector("#llm-status") as HTMLElement | null;
        if (status) setStatus(status, "Cleared", "ready");
      }
    });
  }

  // Quick action buttons
  for (const btn of quickButtons) {
    btn.addEventListener("click", (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!item) return;
      const prompt = btn.dataset.prompt;
      if (!prompt) return;
      sendQuestion(body, item, prompt);
    });
  }
}

async function sendQuestion(
  body: Element,
  item: Zotero.Item,
  question: string,
) {
  const inputBox = body.querySelector(
    "#llm-input",
  ) as HTMLTextAreaElement | null;
  const sendBtn = body.querySelector("#llm-send") as HTMLButtonElement | null;
  const cancelBtn = body.querySelector(
    "#llm-cancel",
  ) as HTMLButtonElement | null;
  const status = body.querySelector("#llm-status") as HTMLElement | null;
  const quickButtons = Array.from(
    body.querySelectorAll(".llm-quick-btn"),
  ) as HTMLButtonElement[];

  // Track this request
  currentRequestId++;
  const thisRequestId = currentRequestId;

  // Show cancel, hide send
  if (sendBtn) sendBtn.style.display = "none";
  if (cancelBtn) cancelBtn.style.display = "";
  if (inputBox) inputBox.disabled = true;
  if (status) {
    setStatus(status, "Thinking...", "sending");
  }
  for (const btn of quickButtons) btn.disabled = true;

  // Add user message
  if (!chatHistory.has(item.id)) {
    chatHistory.set(item.id, []);
  }
  const history = chatHistory.get(item.id)!;
  const historyForLLM = history.slice(-MAX_HISTORY_MESSAGES);
  history.push({ role: "user", text: question, timestamp: Date.now() });
  const assistantMessage: Message = {
    role: "assistant",
    text: "",
    timestamp: Date.now(),
    streaming: true,
  };
  history.push(assistantMessage);
  if (history.length > MAX_HISTORY_MESSAGES * 2) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES * 2);
  }
  refreshChat(body, item);

  try {
    const pdfContext = pdfTextCache.get(item.id) || "";
    const llmHistory: ChatMessage[] = historyForLLM.map((msg) => ({
      role: msg.role,
      content: msg.text,
    }));

    const AbortControllerCtor = getAbortController();
    currentAbortController = AbortControllerCtor ? new AbortControllerCtor() : null;
    let refreshQueued = false;
    const queueRefresh = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => {
        refreshQueued = false;
        refreshChat(body, item);
      }, 50);
    };

    const answer = await callLLMStream(
      {
        prompt: question,
        context: pdfContext,
        history: llmHistory,
        signal: currentAbortController?.signal,
      },
      (delta) => {
        assistantMessage.text += sanitizeText(delta);
        queueRefresh();
      },
    );

    if (cancelledRequestId >= thisRequestId) {
      return;
    }

    assistantMessage.text =
      sanitizeText(answer) || assistantMessage.text || "No response.";
    assistantMessage.streaming = false;
    refreshChat(body, item);

    if (status) setStatus(status, "Ready", "ready");
  } catch (err) {
    if (cancelledRequestId >= thisRequestId) {
      return;
    }

    const errMsg = (err as Error).message || "Error";
    assistantMessage.text = `Error: ${errMsg}`;
    assistantMessage.streaming = false;
    refreshChat(body, item);

    if (status) {
      setStatus(status, `Error: ${errMsg.slice(0, 40)}`, "error");
    }
  } finally {
    // Only restore UI if this is still the current request
    if (cancelledRequestId < thisRequestId) {
      if (inputBox) {
        inputBox.disabled = false;
        inputBox.focus();
      }
      if (sendBtn) {
        sendBtn.style.display = "";
        sendBtn.disabled = false;
      }
      if (cancelBtn) cancelBtn.style.display = "none";
      for (const btn of quickButtons) btn.disabled = false;
    }
    currentAbortController = null;
  }
}

function refreshChat(body: Element, item?: Zotero.Item | null) {
  const chatBox = body.querySelector("#llm-chat-box") as HTMLDivElement | null;
  if (!chatBox) return;
  const doc = body.ownerDocument!;

  if (!item) {
    chatBox.innerHTML = `
      <div class="llm-welcome">
        <div class="llm-welcome-icon">📄</div>
        <div class="llm-welcome-text">Select an item or open a PDF to start.</div>
      </div>
    `;
    return;
  }

  const history = chatHistory.get(item.id) || [];

  if (history.length === 0) {
    chatBox.innerHTML = `
      <div class="llm-welcome">
        <div class="llm-welcome-icon">💬</div>
        <div class="llm-welcome-text">Start a conversation by asking a question or using one of the quick actions above.</div>
      </div>
    `;
    return;
  }

  chatBox.innerHTML = "";

  for (const msg of history) {
    const isUser = msg.role === "user";
    const wrapper = doc.createElement("div") as HTMLDivElement;
    wrapper.className = `llm-message-wrapper ${isUser ? "user" : "assistant"}`;

    const bubble = doc.createElement("div") as HTMLDivElement;
    bubble.className = `llm-bubble ${isUser ? "user" : "assistant"}`;

    if (isUser) {
      bubble.textContent = sanitizeText(msg.text || "");
    } else {
      if (!msg.text) {
        bubble.innerHTML =
          '<div class="llm-typing"><span class="llm-typing-dot"></span><span class="llm-typing-dot"></span><span class="llm-typing-dot"></span></div>';
      } else if (msg.streaming) {
        bubble.classList.add("streaming");
        bubble.textContent = sanitizeText(msg.text);
      } else {
        try {
          const safeText = sanitizeText(msg.text);
          bubble.innerHTML = renderMarkdown(safeText);
        } catch (err) {
          ztoolkit.log("LLM render error:", err);
          bubble.textContent = sanitizeText(msg.text);
        }
      }
    }

    const meta = doc.createElement("div") as HTMLDivElement;
    meta.className = "llm-message-meta";

    const time = doc.createElement("span") as HTMLSpanElement;
    time.className = "llm-message-time";
    time.textContent = formatTime(msg.timestamp);
    meta.appendChild(time);

    wrapper.appendChild(bubble);
    wrapper.appendChild(meta);
    chatBox.appendChild(wrapper);
  }

  // Scroll to bottom
  chatBox.scrollTop = chatBox.scrollHeight;
}

export function clearConversation(itemId: number) {
  chatHistory.delete(itemId);
}

export function getConversationHistory(itemId: number): Message[] {
  return chatHistory.get(itemId) || [];
}
