const HTML_NS = "http://www.w3.org/1999/xhtml";

type SnapshotCommentComposerOptions = {
  document: Document;
  initialComment?: string;
  onSave: (comment: string) => void;
  onDismiss?: () => void;
};

const createHtmlElement = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tagName: K,
): HTMLElementTagNameMap[K] =>
  doc.createElementNS(HTML_NS, tagName) as HTMLElementTagNameMap[K];

export function showSnapshotCommentComposer(
  options: SnapshotCommentComposerOptions,
): () => void {
  const { document: doc } = options;
  doc
    .querySelectorAll("[data-llm-snapshot-comment-composer='true']")
    .forEach((element) => element.remove());

  const form = createHtmlElement(doc, "form");
  form.dataset.llmSnapshotCommentComposer = "true";
  form.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:24px",
    "z-index:2147483647",
    "display:flex",
    "align-items:flex-end",
    "gap:8px",
    "width:420px",
    "max-width:calc(100vw - 24px)",
    "min-height:62px",
    "padding:8px 9px 8px 16px",
    "box-sizing:border-box",
    "border:1px solid rgba(127,127,127,0.32)",
    "border-radius:24px",
    "color-scheme:light dark",
    "background:Canvas",
    "color:CanvasText",
    "box-shadow:0 12px 34px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.14)",
    "transform:translate(-50%, 5px)",
    "opacity:0",
    "transition:opacity 150ms ease, transform 180ms ease",
  ].join(";");

  const input = createHtmlElement(doc, "textarea");
  input.rows = 2;
  input.value = options.initialComment || "";
  input.placeholder = "Add an optional comment…";
  input.setAttribute("aria-label", "Optional comment for screenshot");
  input.setAttribute("contenteditable", "true");
  input.style.cssText = [
    "display:block",
    "flex:1",
    "min-width:0",
    "height:46px",
    "min-height:46px",
    "max-height:92px",
    "padding:2px 0",
    "box-sizing:border-box",
    "border:0",
    "outline:none",
    "resize:none",
    "overflow-y:auto",
    "scrollbar-width:thin",
    "background:transparent",
    "color:inherit",
    "font:inherit",
    "font-size:13px",
    "line-height:1.4",
  ].join(";");

  const saveButton = createHtmlElement(doc, "button");
  saveButton.type = "submit";
  saveButton.textContent = "↑";
  saveButton.title = "Save comment";
  saveButton.setAttribute("aria-label", "Save optional screenshot comment");
  saveButton.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "flex:0 0 32px",
    "width:32px",
    "height:32px",
    "padding:0",
    "border:0",
    "border-radius:50%",
    "background:#1f1f1f",
    "color:#fff",
    "font-size:20px",
    "line-height:1",
    "cursor:pointer",
    "transition:opacity 120ms ease, transform 120ms ease",
  ].join(";");
  form.append(input, saveButton);

  let closed = false;
  let outsideListenerInstalled = false;
  const win = doc.defaultView;
  const syncSaveButton = () => {
    const enabled = Boolean(input.value.trim());
    saveButton.disabled = !enabled;
    saveButton.style.opacity = enabled ? "1" : "0.28";
    saveButton.style.cursor = enabled ? "pointer" : "default";
  };
  const destroy = () => {
    if (closed) return;
    closed = true;
    win?.removeEventListener("pointerdown", handleOutsidePointer, true);
    win?.removeEventListener("mousedown", handleOutsidePointer, true);
    form.remove();
  };
  const dismiss = () => {
    destroy();
    options.onDismiss?.();
  };
  const save = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const comment = input.value.trim();
    if (!comment) return;
    options.onSave(comment);
    destroy();
  };
  const handleOutsidePointer = (event: Event) => {
    const target = event.target as Node | null;
    if (!target || form.contains(target)) return;
    dismiss();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      save(event);
      return;
    }
    event.stopPropagation();
  };

  input.addEventListener("input", syncSaveButton);
  input.addEventListener("keydown", handleKeyDown);
  form.addEventListener("submit", save);
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("mousedown", (event) => event.stopPropagation());
  syncSaveButton();
  doc.body?.appendChild(form);
  win?.requestAnimationFrame(() => {
    if (closed) return;
    form.style.opacity = "1";
    form.style.transform = "translate(-50%, 0)";
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    win.setTimeout(() => {
      if (closed || outsideListenerInstalled) return;
      outsideListenerInstalled = true;
      win.addEventListener("pointerdown", handleOutsidePointer, true);
      win.addEventListener("mousedown", handleOutsidePointer, true);
    }, 0);
  });

  return destroy;
}
