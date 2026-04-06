import { config, GLOBAL_CONVERSATION_KEY_BASE } from "./constants";
import {
  activeContextPanels,
  activeContextPanelRawItems,
  activeContextPanelStateSync,
  activeGlobalConversationByLibrary,
} from "./state";
import {
  resolveActiveLibraryID,
  resolveDisplayConversationKind,
  resolveInitialPanelItemState,
  resolveConversationBaseItem,
  createGlobalPortalItem,
  createPaperPortalItem,
} from "./portalScope";
import { getLockedGlobalConversationKey } from "./prefHelpers";
import { applyPanelFontScale } from "./prefHelpers";
import { buildUI } from "./buildUI";
import { setupHandlers } from "./setupHandlers";
import {
  ensureConversationLoaded,
  getConversationKey,
  refreshChat,
} from "./chat";
import { renderShortcuts } from "./shortcuts";
import { createElement, HTML_NS } from "../../utils/domHelpers";
import { t } from "../../utils/i18n";
import {
  createGlobalConversation,
  ensureGlobalConversationExists,
} from "../../utils/chatStore";
import { loadConversationHistoryScope } from "./historyLoader";

type StandaloneSessionState = {
  pending: boolean;
  window: Window | null;
};

const standaloneSessionState: StandaloneSessionState = {
  pending: false,
  window: null,
};

function getStandaloneSessionWindow(): Window | null {
  const candidate = standaloneSessionState.window || addon.data.standaloneWindow || null;
  if (!candidate || candidate.closed) {
    standaloneSessionState.window = null;
    if (addon.data.standaloneWindow === candidate) {
      addon.data.standaloneWindow = undefined;
    }
    return null;
  }
  standaloneSessionState.window = candidate;
  if (addon.data.standaloneWindow !== candidate) {
    addon.data.standaloneWindow = candidate;
  }
  return candidate;
}

function setStandaloneSessionWindow(win: Window | null): void {
  standaloneSessionState.window = win && !win.closed ? win : null;
  addon.data.standaloneWindow = standaloneSessionState.window || undefined;
}

function setStandalonePending(pending: boolean): void {
  standaloneSessionState.pending = pending;
}

/** Returns true when the standalone chat window is open or being opened. */
export function isStandaloneWindowActive(): boolean {
  if (standaloneSessionState.pending) return true;
  return Boolean(getStandaloneSessionWindow());
}

function isStandaloneTrackedBody(body: Element): boolean {
  const standaloneWin = getStandaloneSessionWindow();
  if (standaloneWin && body.ownerDocument === standaloneWin.document) {
    return true;
  }
  return (body as HTMLElement).dataset?.standalone === "true";
}

function renderStandalonePlaceholdersInEmbeddedPanels(
  excludedBody?: Element | null,
): void {
  const seenBodies = new Set<Element>();
  const mainWindows = Zotero.getMainWindows?.() || [];
  for (const win of mainWindows) {
    const panelRoots = win?.document?.querySelectorAll?.("#llm-main") || [];
    for (const panelRoot of panelRoots) {
      const body = (panelRoot as Element).parentElement;
      if (
        !body ||
        !body.isConnected ||
        body === excludedBody ||
        isStandaloneTrackedBody(body) ||
        seenBodies.has(body)
      ) {
        continue;
      }
      renderStandalonePlaceholder(body);
      seenBodies.add(body);
    }
  }
  for (const [body] of activeContextPanels) {
    if (
      !(body as Element).isConnected ||
      body === excludedBody ||
      isStandaloneTrackedBody(body as Element) ||
      seenBodies.has(body as Element)
    ) {
      continue;
    }
    renderStandalonePlaceholder(body as Element);
    seenBodies.add(body as Element);
  }
}

function restoreEmbeddedPanelsAfterStandaloneClose(excludedBody?: Element | null): void {
  for (const [body] of activeContextPanels) {
    if (excludedBody && body === excludedBody) continue;
    if (!(body as Element).isConnected) {
      activeContextPanels.delete(body);
      activeContextPanelRawItems.delete(body);
      activeContextPanelStateSync.delete(body);
      continue;
    }
    const rawItem = activeContextPanelRawItems.get(body as Element) || null;
    const resolved = resolveInitialPanelItemState(rawItem);
    buildUI(body as Element, resolved.item);
    activeContextPanels.set(body, () => resolved.item);
    setupHandlers(body as Element, rawItem);
    void (async () => {
      try {
        if (resolved.item) await ensureConversationLoaded(resolved.item);
        await renderShortcuts(body as Element, resolved.item);
        refreshChat(body as Element, resolved.item);
      } catch (err) {
        ztoolkit.log("LLM: side panel restore failed", err);
      }
    })();
  }
}

/**
 * Replace a side-panel body with a placeholder message while the
 * standalone window is open.
 */
export function renderStandalonePlaceholder(body: Element): void {
  if (typeof (body as any).replaceChildren === "function") {
    (body as any).replaceChildren();
  } else {
    body.textContent = "";
  }
  const doc = body.ownerDocument!;
  const wrap = createElement(doc, "div", "llm-standalone-placeholder");
  wrap.style.cssText =
    "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "height:100%;gap:12px;padding:24px;text-align:center;color:var(--fill-secondary);";

  const msg = createElement(doc, "div", "", {
    textContent: t("Chat is open in a separate window"),
  });
  msg.style.cssText = "font-size:13px;";

  const focusBtn = createElement(doc, "button", "llm-btn llm-btn-primary", {
    textContent: t("Focus Window"),
    type: "button",
  });
  focusBtn.style.cssText =
    "padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;" +
    "background:var(--color-accent,#2563eb);color:#fff;border:none;";
  focusBtn.addEventListener("click", () => {
    getStandaloneSessionWindow()?.focus();
  });

  const closeBtn = createElement(doc, "button", "llm-btn", {
    textContent: t("Close Window & Return Here"),
    type: "button",
  });
  closeBtn.style.cssText =
    "padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;" +
    "background:none;color:var(--fill-secondary);border:1px solid var(--stroke-secondary,#888);";
  closeBtn.addEventListener("click", () => {
    try {
      const win =
        getStandaloneSessionWindow() ||
        (addon.data.standaloneWindow as Window | undefined) ||
        null;
      ztoolkit.log("LLM: close standalone clicked, win=", Boolean(win), "closed=", win ? (win as any).closed : "N/A");
      if (win && !(win as any).closed) {
        (win as any).close();
      }
    } catch (err) {
      ztoolkit.log("LLM: close standalone failed", err);
    }
  });

  wrap.append(msg, focusBtn, closeBtn);
  body.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Day-group helpers for sidebar
// ---------------------------------------------------------------------------

type SidebarConv = { conversationKey: number; lastActivityAt: number; title?: string; sessionVersion?: number };

function getDayGroupLabel(ts: number): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 6 * 86_400_000;
  const monthStart = todayStart - 29 * 86_400_000;

  if (ts >= todayStart) return t("Today");
  if (ts >= yesterdayStart) return t("Yesterday");
  if (ts >= weekStart) return t("Last 7 days");
  if (ts >= monthStart) return t("Last 30 days");
  return t("Older");
}

function groupByDay(
  conversations: SidebarConv[],
): Array<{ label: string; items: SidebarConv[] }> {
  const groups: Array<{ label: string; items: SidebarConv[] }> = [];
  let currentLabel = "";
  for (const conv of conversations) {
    const label = getDayGroupLabel(conv.lastActivityAt);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(conv);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Standalone window
// ---------------------------------------------------------------------------

/**
 * Open the LLM chat in a standalone window. If already open, focuses it.
 */
export function openStandaloneChat(options?: {
  initialItem?: Zotero.Item | null;
  sourceBody?: Element | null;
}): void {
  const existingWin = getStandaloneSessionWindow();
  if (existingWin) {
    existingWin.focus();
    return;
  }

  const mainWin = Zotero.getMainWindow();
  if (!mainWin) return;

  const sourceItem = options?.initialItem || null;
  const resolvedSourceState = resolveInitialPanelItemState(sourceItem);
  const initialBasePaperItem =
    resolvedSourceState.basePaperItem ||
    resolveConversationBaseItem(sourceItem) ||
    null;
  const initialDisplayConversationKind = resolveDisplayConversationKind(
    resolvedSourceState.item || sourceItem,
  );
  // Determine initial mode: if a paper context is available, default to paper
  // even when resolveDisplayConversationKind returns null (e.g. raw attachment).
  const initialMode: "open" | "paper" =
    initialDisplayConversationKind === "paper"
      ? "paper"
      : initialBasePaperItem
        ? "paper"
        : "open";
  const initialLibraryID =
    Number(
      resolvedSourceState.item?.libraryID ||
      initialBasePaperItem?.libraryID ||
      resolveActiveLibraryID() ||
      1,
    ) || 1;

  // Resolve which global conversation to show
  const libraryID = initialLibraryID > 0 ? Math.floor(initialLibraryID) : 1;
  const lockedKey = getLockedGlobalConversationKey(libraryID);
  const conversationKey =
    lockedKey ??
    activeGlobalConversationByLibrary.get(libraryID) ??
    GLOBAL_CONVERSATION_KEY_BASE;
  const globalPortalItem = createGlobalPortalItem(libraryID, conversationKey);
  const initialPaperItem =
    initialMode === "paper"
      ? resolvedSourceState.item || initialBasePaperItem
      : null;
  const initialMountedItem = initialPaperItem || globalPortalItem;

  // Set flag BEFORE openDialog — keeps isStandaloneWindowActive() true
  // throughout the entire openDialog + load cycle so any onRender calls
  // in the sidepanel will show the placeholder.
  setStandalonePending(true);

  const newWin = mainWin.openDialog(
    `chrome://${config.addonRef}/content/standaloneChat.xhtml`,
    "llmforzotero-standalone-chat",
    "chrome,extrachrome,menubar,resizable,scrollbars,status,centerscreen",
  ) as Window | null;
  if (!newWin) {
    setStandalonePending(false);
    return;
  }

  if (options?.sourceBody && options.sourceBody.isConnected) {
    renderStandalonePlaceholder(options.sourceBody);
  }
  renderStandalonePlaceholdersInEmbeddedPanels(options?.sourceBody || null);

  setStandaloneSessionWindow(newWin);
  // Keep standalonePending = true until initWindow runs — see below
  let cancelled = false;

  // Mutable state for the standalone window
  let standaloneMode: "open" | "paper" = initialMode;
  let activeConversationKey = getConversationKey(initialMountedItem);
  let activeItem: Zotero.Item = initialMountedItem;
  let currentPaperItem: Zotero.Item | null = initialPaperItem;
  let currentBasePaperItem: Zotero.Item | null = initialBasePaperItem;

  const initWindow = () => {
    // Now the window is loaded — safe to clear the pending flag.
    // isStandaloneWindowActive() will still return true because
    // addon.data.standaloneWindow is set and not closed.
    setStandalonePending(false);
    // Reset cancelled — the about:blank → XHTML transition in XUL may
    // fire an early unload that sets cancelled=true before load fires.
    cancelled = false;
    // Re-store the window reference for the same reason.
    setStandaloneSessionWindow(newWin);
    // Register the real unload handler now that the document is loaded.
    newWin.addEventListener("unload", cleanupWindow, { once: true });
    ztoolkit.log("LLM: standalone initWindow start");

    try {

    const doc = newWin.document;

    // Inject Zotero CSS variables that the standalone window doesn't inherit.
    const zoteroVars = [
      "--fill-primary", "--fill-secondary", "--fill-tertiary",
      "--fill-quaternary", "--fill-quinary",
      "--stroke-primary", "--stroke-secondary",
      "--material-background", "--material-sidepane", "--material-toolbar",
      "--color-accent", "--accent-blue",
    ];
    const mainDocEl = mainWin.document.documentElement;
    const mainStyle = mainDocEl ? mainWin.getComputedStyle(mainDocEl) : null;
    const varDeclarations = zoteroVars
      .map((v) => {
        const val = mainStyle?.getPropertyValue(v).trim();
        return val ? `${v}: ${val};` : "";
      })
      .filter(Boolean)
      .join("\n  ");
    if (varDeclarations) {
      const styleEl = doc.createElementNS(HTML_NS, "style") as HTMLStyleElement;
      styleEl.textContent = `:root {\n  ${varDeclarations}\n}`;
      doc.documentElement?.prepend(styleEl);
    }

    // Inject CSS
    const mainCSS = doc.createElementNS(HTML_NS, "link") as HTMLLinkElement;
    mainCSS.rel = "stylesheet";
    mainCSS.type = "text/css";
    mainCSS.href = `chrome://${config.addonRef}/content/zoteroPane.css`;
    doc.documentElement?.appendChild(mainCSS);

    const katexCSS = doc.createElementNS(HTML_NS, "link") as HTMLLinkElement;
    katexCSS.rel = "stylesheet";
    katexCSS.type = "text/css";
    katexCSS.href = `chrome://${config.addonRef}/content/vendor/katex/katex.min.css`;
    doc.documentElement?.appendChild(katexCSS);

    // Mount into the root div
    const root = doc.getElementById(
      "llmforzotero-standalone-chat-root",
    ) as HTMLElement | null;
    if (!root) return;

    root.dataset.standalone = "true";

    // -----------------------------------------------------------------------
    // Build the shell layout: sidebar | main (topbar + content)
    // -----------------------------------------------------------------------

    // -- Sidebar: icon strip (always visible) + panel (collapsible) --
    const sidebar = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    sidebar.className = "llm-standalone-sidebar";
    sidebar.dataset.sidebarState = "expanded";

    // Icon strip — always visible vertical column
    const iconStrip = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    iconStrip.className = "llm-standalone-icon-strip";

    const iconNewChat = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    iconNewChat.className = "llm-standalone-icon-btn";
    iconNewChat.type = "button";
    iconNewChat.title = t("New chat");
    // Pen-to-square SVG icon
    iconNewChat.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';

    const iconHistory = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    iconHistory.className = "llm-standalone-icon-btn";
    iconHistory.type = "button";
    iconHistory.title = t("History");
    // Clock SVG icon
    iconHistory.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    const iconStripSpacer = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    iconStripSpacer.style.flex = "1";

    const iconToggle = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    iconToggle.className = "llm-standalone-icon-btn llm-standalone-icon-toggle";
    iconToggle.type = "button";
    iconToggle.title = t("Toggle sidebar");
    // Sidebar/panel-left SVG icon
    iconToggle.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

    iconStrip.append(iconNewChat, iconHistory, iconStripSpacer, iconToggle);

    // Panel — the expandable conversation list
    const sidebarPanel = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    sidebarPanel.className = "llm-standalone-sidebar-panel";

    const sidebarHeader = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    sidebarHeader.className = "llm-standalone-sidebar-header";

    const sidebarTitle = doc.createElementNS(HTML_NS, "span") as HTMLSpanElement;
    sidebarTitle.className = "llm-standalone-sidebar-title";
    sidebarTitle.textContent = t("History");

    const newChatBtn = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    newChatBtn.className = "llm-standalone-new-chat-btn";
    newChatBtn.type = "button";
    newChatBtn.title = t("New chat");
    newChatBtn.textContent = "+";

    sidebarHeader.append(sidebarTitle, newChatBtn);

    const sidebarList = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    sidebarList.className = "llm-standalone-sidebar-list";

    sidebarPanel.append(sidebarHeader, sidebarList);
    sidebar.append(iconStrip, sidebarPanel);

    // -- Main area: topbar + content --
    const mainArea = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    mainArea.className = "llm-standalone-main";

    const topbar = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    topbar.className = "llm-standalone-topbar";

    const paperTab = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    paperTab.className = "llm-standalone-tab";
    paperTab.type = "button";
    paperTab.textContent = t("Paper chat");
    paperTab.dataset.tab = "paper";

    const openTab = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    openTab.className = "llm-standalone-tab";
    openTab.type = "button";
    openTab.textContent = t("Open chat");
    openTab.dataset.tab = "open";

    paperTab.classList.toggle("active", standaloneMode === "paper");
    openTab.classList.toggle("active", standaloneMode === "open");

    const topbarSpacer = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    topbarSpacer.style.flex = "1";

    // Close button — return to sidebar
    const topbarCloseBtn = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
    topbarCloseBtn.className = "llm-standalone-icon-btn";
    topbarCloseBtn.type = "button";
    topbarCloseBtn.title = t("Close & return to sidebar");
    topbarCloseBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    topbarCloseBtn.addEventListener("click", () => {
      newWin.close();
    });

    topbar.append(paperTab, openTab, topbarSpacer, topbarCloseBtn);

    const contentArea = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
    contentArea.className = "llm-standalone-content";
    contentArea.dataset.standalone = "true";

    mainArea.append(topbar, contentArea);
    root.append(sidebar, mainArea);

    // -- Sidebar state management --
    let userManualSidebarState: "expanded" | "collapsed" | null = null;

    const setSidebarState = (state: "expanded" | "collapsed") => {
      sidebar.dataset.sidebarState = state;
    };

    const toggleSidebar = () => {
      const current = sidebar.dataset.sidebarState || "expanded";
      const next = current === "expanded" ? "collapsed" : "expanded";
      userManualSidebarState = next;
      setSidebarState(next);
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    const clearContent = () => {
      if (typeof (contentArea as any).replaceChildren === "function") {
        (contentArea as any).replaceChildren();
      } else {
        contentArea.textContent = "";
      }
    };

    const clearSidebarList = () => {
      if (typeof (sidebarList as any).replaceChildren === "function") {
        (sidebarList as any).replaceChildren();
      } else {
        sidebarList.textContent = "";
      }
    };

    const getSelectedZoteroItem = (): Zotero.Item | null => {
      try {
        const pane = Zotero.getActiveZoteroPane?.() as any;
        const items = pane?.getSelectedItems?.();
        return items?.[0] || null;
      } catch {
        return null;
      }
    };

    // -----------------------------------------------------------------------
    // Mount chat UI into contentArea
    // -----------------------------------------------------------------------
    const mountChatPanel = (item: Zotero.Item) => {
      try {
        activeItem = item;
        activeConversationKey = getConversationKey(item);
        clearContent();

        buildUI(contentArea, item);

        const llmMain = contentArea.querySelector("#llm-main") as HTMLElement | null;
        if (llmMain) llmMain.dataset.standalone = "true";

        activeContextPanels.set(contentArea, () => activeItem);
        activeContextPanelRawItems.set(contentArea, null);
        setupHandlers(contentArea, item as any, {
          onConversationHistoryChanged: () => {
            if (cancelled) return;
            void renderSidebar();
          },
        });

        refreshChat(contentArea, item);
        applyPanelFontScale(llmMain);
        void renderShortcuts(contentArea, item);
      } catch (err) {
        ztoolkit.log("LLM: standalone mountChatPanel sync failed", err);
      }

      void (async () => {
        try {
          if (cancelled) return;
          await ensureConversationLoaded(item);
          if (cancelled) return;
          refreshChat(contentArea, item);
          // Refresh sidebar after conversation is confirmed loaded
          void renderSidebar();
        } catch (err) {
          ztoolkit.log("LLM: standalone mount async failed", err);
        }
      })();
    };

    // -----------------------------------------------------------------------
    // Sidebar rendering — supports both open chat and paper chat
    // -----------------------------------------------------------------------
    const renderSidebarItems = (conversations: SidebarConv[]) => {
      clearSidebarList();

      if (conversations.length === 0) {
        const emptyMsg = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
        emptyMsg.className = "llm-standalone-sidebar-empty";
        emptyMsg.textContent = t("No conversations yet");
        sidebarList.appendChild(emptyMsg);
        return;
      }

      const groups = groupByDay(conversations);
      for (const group of groups) {
        const dayLabel = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
        dayLabel.className = "llm-standalone-day-label";
        dayLabel.textContent = group.label;
        sidebarList.appendChild(dayLabel);

        for (const conv of group.items) {
          const btn = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
          btn.className = "llm-standalone-conv-item";
          if (conv.conversationKey === activeConversationKey) {
            btn.classList.add("active");
          }
          btn.type = "button";
          btn.dataset.conversationKey = String(conv.conversationKey);
          if (conv.sessionVersion !== undefined) {
            btn.dataset.sessionVersion = String(conv.sessionVersion);
          }
          btn.textContent = conv.title || t("Untitled chat");
          btn.title = conv.title || t("Untitled chat");
          sidebarList.appendChild(btn);
        }
      }
    };

    const renderSidebar = async () => {
      if (cancelled) return;
      ztoolkit.log(
        "LLM: standalone renderSidebar",
        "mode=" + standaloneMode,
        "hasBasePaper=" + Boolean(currentBasePaperItem),
        "basePaperId=" + (currentBasePaperItem?.id ?? "null"),
        "activeConvKey=" + activeConversationKey,
      );
      try {
        if (standaloneMode === "open") {
          // Ensure the active conversation has a DB row so it appears in listings
          await ensureGlobalConversationExists(libraryID, activeConversationKey);
          const conversations = await loadConversationHistoryScope({
            mode: "open",
            libraryID,
            limit: 50,
          });
          if (cancelled) return;
          sidebarTitle.textContent = t("History");
          renderSidebarItems(conversations);
        } else {
          // Paper chat — list conversations for the current paper
          if (!currentBasePaperItem) {
            ztoolkit.log("LLM: standalone renderSidebar paper mode — currentBasePaperItem is null");
            sidebarTitle.textContent = t("History");
            clearSidebarList();
            return;
          }
          const paperID = Number(currentBasePaperItem.id || 0);
          const paperLibID = Number(currentBasePaperItem.libraryID || libraryID);
          ztoolkit.log(
            "LLM: standalone renderSidebar paper query",
            "paperID=" + paperID,
            "libraryID=" + paperLibID,
          );
          const conversations = await loadConversationHistoryScope({
            mode: "paper",
            libraryID: paperLibID,
            paperItemID: paperID,
            limit: 50,
          });
          ztoolkit.log(
            "LLM: standalone renderSidebar paper results",
            "count=" + conversations.length,
          );
          if (cancelled) return;
          // Use paper title for sidebar header
          const paperTitle = (() => {
            try { return (currentBasePaperItem as any).getField?.("title") || ""; }
            catch { return ""; }
          })();
          sidebarTitle.textContent = paperTitle
            ? paperTitle.length > 25 ? paperTitle.slice(0, 25) + "…" : paperTitle
            : t("Paper History");
          renderSidebarItems(conversations);
        }
      } catch (err) {
        ztoolkit.log("LLM: standalone sidebar render failed", err);
      }
    };

    // Sidebar click handler — switch conversation
    sidebarList.addEventListener("click", (e: Event) => {
      const target = (e.target as HTMLElement).closest(
        ".llm-standalone-conv-item",
      ) as HTMLElement | null;
      if (!target) return;
      const key = Number(target.dataset.conversationKey);
      if (!key || key === activeConversationKey) return;

      activeConversationKey = key;

      // Update active class
      for (const el of sidebarList.querySelectorAll(".llm-standalone-conv-item")) {
        el.classList.remove("active");
      }
      target.classList.add("active");

      if (standaloneMode === "open") {
        const newItem = createGlobalPortalItem(libraryID, key);
        activeGlobalConversationByLibrary.set(libraryID, key);
        mountChatPanel(newItem);
      } else {
        // Paper chat — create paper portal item
        if (currentBasePaperItem) {
          const sessionVersion = Number(target.dataset.sessionVersion || 0);
          const newItem = createPaperPortalItem(currentBasePaperItem, key, sessionVersion);
          mountChatPanel(newItem);
        }
      }
    });

    // New chat button
    newChatBtn.addEventListener("click", async () => {
      try {
        if (standaloneMode === "open") {
          const newKey = await createGlobalConversation(libraryID);
          if (!newKey || cancelled) return;
          activeConversationKey = newKey;
          activeGlobalConversationByLibrary.set(libraryID, newKey);
          const newItem = createGlobalPortalItem(libraryID, newKey);
          mountChatPanel(newItem);
          await renderSidebar();
        } else {
          // Paper chat — mount with the base paper item (creates new session)
          if (currentBasePaperItem) {
            activeConversationKey = 0;
            mountChatPanel(currentBasePaperItem);
            // Sidebar will be refreshed after the new conversation is persisted
          }
        }
      } catch (err) {
        ztoolkit.log("LLM: standalone new chat failed", err);
      }
    });

    // Icon strip handlers
    iconNewChat.addEventListener("click", () => newChatBtn.click());

    iconHistory.addEventListener("click", () => {
      // If collapsed, expand; if already expanded, no-op (panel is visible)
      if (sidebar.dataset.sidebarState === "collapsed") {
        userManualSidebarState = "expanded";
        setSidebarState("expanded");
      }
    });

    iconToggle.addEventListener("click", () => toggleSidebar());

    // -----------------------------------------------------------------------
    // Top bar tab switching
    // -----------------------------------------------------------------------
    const switchToMode = (mode: "open" | "paper") => {
      if (mode === standaloneMode) return;
      standaloneMode = mode;

      // Update tab active states
      paperTab.classList.toggle("active", mode === "paper");
      openTab.classList.toggle("active", mode === "open");

      if (mode === "open") {
        // Restore open chat
        const key =
          activeConversationKey ||
          activeGlobalConversationByLibrary.get(libraryID) ||
          GLOBAL_CONVERSATION_KEY_BASE;
        activeConversationKey = key;
        const item = createGlobalPortalItem(libraryID, key);
        mountChatPanel(item);
        void renderSidebar();
      } else {
        // Paper chat — resolve currently selected paper in Zotero
        const rawItem = currentPaperItem || currentBasePaperItem || getSelectedZoteroItem();
        const resolved = resolveInitialPanelItemState(rawItem);
        currentBasePaperItem = resolved.basePaperItem ||
          (rawItem ? resolveConversationBaseItem(rawItem) : null);
        currentPaperItem = resolved.item || currentBasePaperItem;

        if (currentPaperItem) {
          activeConversationKey = 0; // Will be set by mountChatPanel
          mountChatPanel(currentPaperItem);
          void renderSidebar();
        } else {
          // No paper open — show message
          clearContent();
          const noPaper = doc.createElementNS(HTML_NS, "div") as HTMLDivElement;
          noPaper.style.cssText =
            "display:flex;align-items:center;justify-content:center;" +
            "height:100%;color:var(--fill-tertiary);font-size:14px;";
          noPaper.textContent = t("Open a paper to start a paper chat");
          contentArea.appendChild(noPaper);
          clearSidebarList();
          sidebarTitle.textContent = t("History");
        }
      }
    };

    paperTab.addEventListener("click", () => switchToMode("paper"));
    openTab.addEventListener("click", () => switchToMode("open"));

    // Auto-collapse sidebar when window is narrow, respecting manual override.
    // ResizeObserver is unavailable in some Gecko/XUL window contexts —
    // fall back to a simple resize event listener.
    const SIDEBAR_AUTO_THRESHOLD = 700;
    let lastAutoState: "expanded" | "collapsed" | null = null;
    const handleResize = () => {
      const width = root.clientWidth || 0;
      const autoState = width < SIDEBAR_AUTO_THRESHOLD ? "collapsed" : "expanded";
      if (userManualSidebarState !== null) {
        if (lastAutoState !== null && autoState !== lastAutoState) {
          userManualSidebarState = null;
          setSidebarState(autoState);
        }
      } else {
        setSidebarState(autoState);
      }
      lastAutoState = autoState;
    };
    const RO = (newWin as any).ResizeObserver || (globalThis as any).ResizeObserver;
    if (RO) {
      const resizeObserver = new RO((entries: any[]) => {
        const width = entries[0]?.contentRect?.width || root.clientWidth || 0;
        const autoState = width < SIDEBAR_AUTO_THRESHOLD ? "collapsed" : "expanded";
        if (userManualSidebarState !== null) {
          if (lastAutoState !== null && autoState !== lastAutoState) {
            userManualSidebarState = null;
            setSidebarState(autoState);
          }
        } else {
          setSidebarState(autoState);
        }
        lastAutoState = autoState;
      });
      resizeObserver.observe(root);
    } else {
      newWin.addEventListener("resize", handleResize);
      handleResize();
    }

    // Initial mount — preserve the source panel mode/item when available
    ztoolkit.log(
      "LLM: standalone mounting initial item",
      "mode=" + standaloneMode,
      "itemId=" + (initialMountedItem?.id ?? "null"),
      "convKey=" + getConversationKey(initialMountedItem),
    );
    mountChatPanel(initialMountedItem);

    // Load sidebar initially
    ztoolkit.log("LLM: standalone renderSidebar start", "mode=" + standaloneMode);
    void renderSidebar();
    renderStandalonePlaceholdersInEmbeddedPanels(contentArea);

    } catch (err) {
      ztoolkit.log("LLM: standalone initWindow failed", err);
      // Show a visible error so the window isn't silently blank
      try {
        const root = newWin.document?.getElementById(
          "llmforzotero-standalone-chat-root",
        );
        const target = root || newWin.document?.body;
        if (target) {
          const msg = newWin.document.createElementNS(HTML_NS, "div") as HTMLDivElement;
          msg.style.cssText =
            "display:flex;align-items:center;justify-content:center;" +
            "height:100%;color:#f87171;font-size:14px;padding:24px;text-align:center;";
          msg.textContent = "Failed to initialize chat window. Check the error console for details.";
          target.appendChild(msg);
        }
      } catch { /* ignore fallback errors */ }
    }
  };

  const cleanupWindow = () => {
    cancelled = true;
    setStandalonePending(false);
    // Remove the standalone window's content area from panel tracking
    const root = newWin.document?.getElementById(
      "llmforzotero-standalone-chat-root",
    );
    const contentArea = root?.querySelector(".llm-standalone-content");
    if (contentArea) {
      activeContextPanels.delete(contentArea);
      activeContextPanelRawItems.delete(contentArea);
      activeContextPanelStateSync.delete(contentArea);
    }
    const sessionWin = getStandaloneSessionWindow();
    if (sessionWin === newWin || sessionWin === null) {
      setStandaloneSessionWindow(null);
    }
    restoreEmbeddedPanelsAfterStandaloneClose(contentArea as Element | null);
  };

  newWin.addEventListener("load", initWindow, { once: true });
  // Note: unload is registered inside initWindow to avoid the XUL
  // about:blank → document transition firing a premature unload.
}
