import { createElement } from "../../../../utils/domHelpers";
import { t } from "../../../../utils/i18n";
import {
  addSelectedTextContext,
  getSelectedTextContextEntries,
  updateSelectedTextContextCommentForItem,
} from "../../contextResolution";
import {
  clampNumber,
  getSelectedTextWithinBubble,
  sanitizeText,
  setStatus,
} from "../../textUtils";

type AssistantSelectionPopupDeps = {
  body: Element;
  panelRoot: HTMLDivElement;
  panelDoc: Document;
  panelWin: Window | null;
  chatBox: HTMLDivElement | null;
  inputBox: HTMLTextAreaElement;
  status: HTMLElement | null;
  getItem: () => Zotero.Item | null;
  getTextContextConversationKey: () => number | null;
  runWithChatScrollGuard: (fn: () => void) => void;
  updateSelectedTextPreviewPreservingScroll: () => void;
  isElementNode: (value: unknown) => value is Element;
};

export function attachAssistantSelectionPopup(
  deps: AssistantSelectionPopupDeps,
): void {
  const {
    body,
    panelRoot,
    panelDoc,
    panelWin,
    chatBox,
    inputBox,
    status,
    getItem,
    getTextContextConversationKey,
    runWithChatScrollGuard,
    updateSelectedTextPreviewPreservingScroll,
    isElementNode,
  } = deps;
  const popupHost = panelRoot as HTMLDivElement & {
    __llmSelectionPopupCleanup?: () => void;
  };
  panelRoot
    .querySelectorAll(".llm-assistant-selection-action")
    .forEach((node: Element) => node.remove());
  if (popupHost.__llmSelectionPopupCleanup) {
    popupHost.__llmSelectionPopupCleanup();
    delete popupHost.__llmSelectionPopupCleanup;
  }
  const selectionPopup = createElement(
    panelDoc,
    "div",
    "llm-assistant-selection-action",
  ) as HTMLDivElement;
  const quoteButton = createElement(
    panelDoc,
    "button",
    "llm-shortcut-btn llm-assistant-selection-quote-btn",
    {
      type: "button",
      textContent: "❞ Quote",
      title: "Quote selected text",
    },
  ) as HTMLButtonElement;
  const commentComposer = createElement(
    panelDoc,
    "form",
    "llm-assistant-selection-comment-composer",
  ) as HTMLFormElement;
  const commentInput = createElement(
    panelDoc,
    "textarea",
    "llm-assistant-selection-comment-input",
    {
      placeholder: "Add an optional comment…",
      title: "Optional comment for quoted response text",
    },
  ) as HTMLTextAreaElement;
  commentInput.rows = 1;
  commentInput.setAttribute(
    "aria-label",
    "Optional comment for quoted response text",
  );
  const commentSubmit = createElement(
    panelDoc,
    "button",
    "llm-assistant-selection-comment-submit",
    {
      type: "submit",
      textContent: "↑",
      title: "Save comment",
    },
  ) as HTMLButtonElement;
  commentSubmit.disabled = true;
  commentSubmit.setAttribute("aria-label", "Save optional quote comment");
  commentComposer.append(commentInput, commentSubmit);
  selectionPopup.append(quoteButton, commentComposer);
  panelRoot.appendChild(selectionPopup);
  let selectionPopupText = "";
  let commentModeActive = false;
  let commentTarget: { itemId: number; text: string } | null = null;
  let selectionDragStartBubble: HTMLElement | null = null;
  let disposeSelectionPopup: () => void = () => {};

  const showSelectionPopup = () => {
    if (!selectionPopup.classList.contains("is-visible")) {
      selectionPopup.classList.add("is-visible");
    }
  };
  const hideSelectionPopup = () => {
    selectionPopup.classList.remove("is-visible", "is-comment-mode");
    selectionPopupText = "";
    commentModeActive = false;
    commentTarget = null;
    commentInput.value = "";
    commentInput.style.height = "";
    commentInput.style.overflowY = "hidden";
    commentSubmit.disabled = true;
  };

  const syncCommentSubmit = () => {
    commentSubmit.disabled = !commentInput.value.trim();
  };

  const resizeCommentInput = () => {
    const minimumHeight = 32;
    const maximumHeight = 88;
    commentInput.style.height = `${minimumHeight}px`;
    const nextHeight = clampNumber(
      commentInput.scrollHeight,
      minimumHeight,
      maximumHeight,
    );
    commentInput.style.height = `${Math.round(nextHeight)}px`;
    commentInput.style.overflowY =
      commentInput.scrollHeight > maximumHeight ? "auto" : "hidden";
  };

  const fitCommentPopupWithinChat = () => {
    if (!chatBox) return;
    const panelRect = panelRoot.getBoundingClientRect();
    const chatRect = chatBox.getBoundingClientRect();
    const popupRect = selectionPopup.getBoundingClientRect();
    const margin = 8;
    const hostLeft = chatRect.left - panelRect.left;
    const hostTop = chatRect.top - panelRect.top;
    const hostRight = hostLeft + chatRect.width;
    const hostBottom = hostTop + chatRect.height;
    const currentLeft = Number.parseFloat(selectionPopup.style.left || "0");
    const currentTop = Number.parseFloat(selectionPopup.style.top || "0");
    selectionPopup.style.left = `${Math.round(
      clampNumber(
        currentLeft,
        hostLeft + margin,
        hostRight - popupRect.width - margin,
      ),
    )}px`;
    selectionPopup.style.top = `${Math.round(
      clampNumber(
        currentTop,
        hostTop + margin,
        hostBottom - popupRect.height - margin,
      ),
    )}px`;
  };

  const showCommentComposer = (itemId: number, text: string) => {
    commentModeActive = true;
    commentTarget = { itemId, text };
    commentInput.value = "";
    resizeCommentInput();
    syncCommentSubmit();
    selectionPopup.classList.add("is-comment-mode", "is-visible");
    panelWin?.requestAnimationFrame(() => {
      fitCommentPopupWithinChat();
      commentInput.focus({ preventScroll: true });
    });
  };

  const findAssistantBubbleFromSelection = (): HTMLElement | null => {
    if (!chatBox || !panelWin) return null;
    const selection = panelWin.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    const anchorEl = isElementNode(selection.anchorNode)
      ? selection.anchorNode
      : selection.anchorNode?.parentElement || null;
    const focusEl = isElementNode(selection.focusNode)
      ? selection.focusNode
      : selection.focusNode?.parentElement || null;
    if (!anchorEl || !focusEl) return null;
    const bubbleA = anchorEl.closest(".llm-bubble.assistant");
    const bubbleB = focusEl.closest(".llm-bubble.assistant");
    if (!bubbleA || !bubbleB || bubbleA !== bubbleB) return null;
    if (!chatBox.contains(bubbleA)) return null;
    return bubbleA as HTMLElement;
  };

  const updateSelectionPopup = (bubble?: HTMLElement | null) => {
    if (commentModeActive) return;
    if (
      !panelWin ||
      !chatBox ||
      !panelRoot.isConnected ||
      panelRoot.getClientRects().length === 0
    ) {
      hideSelectionPopup();
      return;
    }
    const targetBubble = bubble || findAssistantBubbleFromSelection();
    if (targetBubble?.closest(".llm-agent-reasoning")) {
      hideSelectionPopup();
      return;
    }
    if (!targetBubble) {
      hideSelectionPopup();
      return;
    }
    const selected = sanitizeText(
      getSelectedTextWithinBubble(panelDoc, targetBubble),
    ).trim();
    if (!selected) {
      hideSelectionPopup();
      return;
    }
    selectionPopupText = selected;
    const selection = panelWin.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideSelectionPopup();
      return;
    }
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    const rects = range.getClientRects();
    const anchorRect =
      rects && rects.length > 0
        ? rects[rects.length - 1] || rects[0] || rect
        : rect;
    let focusRect: DOMRect | null = null;
    try {
      const focusNode = selection.focusNode;
      if (focusNode) {
        const focusRange = panelDoc.createRange();
        focusRange.setStart(focusNode, selection.focusOffset);
        focusRange.setEnd(focusNode, selection.focusOffset);
        let fr = focusRange.getBoundingClientRect();
        const frs = focusRange.getClientRects();
        if ((!fr.width || !fr.height) && frs && frs.length > 0) {
          const first = frs[0];
          if (first) fr = first;
        }
        if (fr.width || fr.height) {
          focusRect = fr;
        }
      }
    } catch (_err) {
      void _err;
    }
    const positionRect = focusRect || anchorRect || rect;
    if ((!rect.width || !rect.height) && anchorRect) {
      rect = anchorRect;
    }
    if (!rect.width && !rect.height) {
      hideSelectionPopup();
      return;
    }
    const panelRect = panelRoot.getBoundingClientRect();
    const chatRect = chatBox.getBoundingClientRect();
    const popupRect = selectionPopup.getBoundingClientRect();
    const margin = 8;
    const hostLeft = chatRect.left - panelRect.left;
    const hostTop = chatRect.top - panelRect.top;
    const hostRight = hostLeft + chatRect.width;
    const hostBottom = hostTop + chatRect.height;
    const focusX = positionRect.right - panelRect.left;
    const focusTop = positionRect.top - panelRect.top;
    const focusBottom = positionRect.bottom - panelRect.top;
    let left = focusX + 8;
    let top = focusTop - popupRect.height - 10;
    if (top < hostTop + margin) top = rect.bottom - panelRect.top + 10;
    if (top < hostTop + margin) top = focusBottom + 10;
    if (left > hostRight - popupRect.width - margin) {
      left = focusX - popupRect.width - 8;
    }
    left = clampNumber(
      left,
      hostLeft + margin,
      hostRight - popupRect.width - margin,
    );
    top = clampNumber(
      top,
      hostTop + margin,
      hostBottom - popupRect.height - margin,
    );
    selectionPopup.style.left = `${Math.round(left)}px`;
    selectionPopup.style.top = `${Math.round(top)}px`;
    showSelectionPopup();
  };

  const quoteSelectedAssistantText = () => {
    if (!getItem()) {
      hideSelectionPopup();
      return;
    }
    let selected = sanitizeText(selectionPopupText).trim();
    if (!selected) {
      const targetBubble = findAssistantBubbleFromSelection();
      if (targetBubble) {
        selected = sanitizeText(
          getSelectedTextWithinBubble(panelDoc, targetBubble),
        ).trim();
      }
    }
    if (!selected) {
      hideSelectionPopup();
      if (status) setStatus(status, t("No assistant text selected"), "error");
      return;
    }
    let added = false;
    const activeItemId = getTextContextConversationKey();
    if (!activeItemId) {
      hideSelectionPopup();
      return;
    }
    const alreadyIncluded = getSelectedTextContextEntries(activeItemId).some(
      (context) => context.source === "model" && context.text === selected,
    );
    if (alreadyIncluded) {
      if (status) {
        setStatus(status, "Selected response text already included", "ready");
      }
      showCommentComposer(activeItemId, selected);
      return;
    }
    runWithChatScrollGuard(() => {
      added = addSelectedTextContext(body, activeItemId, selected, {
        successStatusText: "Selected response text included",
        focusInput: false,
        source: "model",
      });
    });
    if (added) {
      updateSelectedTextPreviewPreservingScroll();
      showCommentComposer(activeItemId, selected);
      return;
    }
    hideSelectionPopup();
  };

  const submitQuoteComment = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const target = commentTarget;
    const comment = commentInput.value.trim();
    if (!target || !comment) return;
    let updated = false;
    runWithChatScrollGuard(() => {
      updated = updateSelectedTextContextCommentForItem(
        target.itemId,
        target.text,
        comment,
        "model",
      );
    });
    if (!updated) {
      if (status) setStatus(status, "Unable to save quote comment", "error");
      return;
    }
    updateSelectedTextPreviewPreservingScroll();
    hideSelectionPopup();
    inputBox.focus({ preventScroll: true });
  };

  const onCommentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideSelectionPopup();
      inputBox.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      submitQuoteComment(event);
    }
  };

  const onPanelMouseUp = (e: Event) => {
    if (!panelWin) return;
    if (!panelRoot.isConnected) {
      disposeSelectionPopup();
      return;
    }
    const me = e as MouseEvent;
    if (typeof me.button === "number" && me.button !== 0) {
      selectionDragStartBubble = null;
      hideSelectionPopup();
      return;
    }
    const target = e.target as Element | null;
    if (target && selectionPopup.contains(target)) return;
    const targetInsidePanel = Boolean(target && panelRoot.contains(target));
    if (!targetInsidePanel && !selectionDragStartBubble) {
      hideSelectionPopup();
      return;
    }
    if (target && target.closest("summary.llm-agent-reasoning-summary")) {
      hideSelectionPopup();
      return;
    }
    const bubble = target?.closest(
      ".llm-bubble.assistant",
    ) as HTMLElement | null;
    const fallbackBubble = bubble || selectionDragStartBubble;
    selectionDragStartBubble = null;
    panelWin.setTimeout(() => updateSelectionPopup(fallbackBubble), 0);
  };
  const onDocKeyUp = () => {
    if (!panelRoot.isConnected) {
      disposeSelectionPopup();
      return;
    }
    if (commentModeActive && panelDoc.activeElement === commentInput) return;
    panelWin?.setTimeout(() => updateSelectionPopup(), 0);
  };
  const onPanelPointerDown = (e: Event) => {
    const target = e.target as Node | null;
    if (target && selectionPopup.contains(target)) return;
    const targetEl = target as Element | null;
    selectionDragStartBubble =
      (targetEl?.closest(".llm-bubble.assistant") as HTMLElement | null) ||
      null;
    hideSelectionPopup();
  };
  const onChatScrollHide = () => {
    if (commentModeActive) {
      panelWin?.requestAnimationFrame(fitCommentPopupWithinChat);
      return;
    }
    hideSelectionPopup();
  };
  const onChatContextMenu = () => hideSelectionPopup();

  const triggerSelectionPopupAction = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    quoteSelectedAssistantText();
  };
  const isPrimarySelectionPopupEvent = (e: Event): boolean => {
    const maybeMouse = e as MouseEvent;
    return typeof maybeMouse.button !== "number" || maybeMouse.button === 0;
  };
  const preserveQuoteSelection = (e: Event) => {
    if (!isPrimarySelectionPopupEvent(e)) return;
    // Keep the browser selection intact until the button's one semantic
    // activation (`click`). Pointer/mouse compatibility events must never
    // submit the quote themselves or one gesture becomes several additions.
    e.preventDefault();
    e.stopPropagation();
  };
  quoteButton.addEventListener("pointerdown", preserveQuoteSelection);
  quoteButton.addEventListener("mousedown", preserveQuoteSelection);
  quoteButton.addEventListener("click", triggerSelectionPopupAction);
  selectionPopup.addEventListener("contextmenu", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    hideSelectionPopup();
  });
  commentInput.addEventListener("input", () => {
    syncCommentSubmit();
    resizeCommentInput();
    panelWin?.requestAnimationFrame(fitCommentPopupWithinChat);
  });
  commentInput.addEventListener("keydown", onCommentKeyDown);
  commentComposer.addEventListener("submit", submitQuoteComment);

  panelDoc.addEventListener("mouseup", onPanelMouseUp, true);
  panelDoc.addEventListener("keyup", onDocKeyUp, true);
  panelRoot.addEventListener("pointerdown", onPanelPointerDown, true);
  chatBox?.addEventListener("scroll", onChatScrollHide, { passive: true });
  chatBox?.addEventListener("contextmenu", onChatContextMenu, true);
  panelWin?.addEventListener("resize", onChatScrollHide, { passive: true });

  disposeSelectionPopup = () => {
    panelDoc.removeEventListener("mouseup", onPanelMouseUp, true);
    panelDoc.removeEventListener("keyup", onDocKeyUp, true);
    panelRoot.removeEventListener("pointerdown", onPanelPointerDown, true);
    chatBox?.removeEventListener("scroll", onChatScrollHide);
    chatBox?.removeEventListener("contextmenu", onChatContextMenu, true);
    panelWin?.removeEventListener("resize", onChatScrollHide);
    selectionPopup.remove();
    if (popupHost.__llmSelectionPopupCleanup === disposeSelectionPopup) {
      delete popupHost.__llmSelectionPopupCleanup;
    }
  };
  popupHost.__llmSelectionPopupCleanup = disposeSelectionPopup;
}
