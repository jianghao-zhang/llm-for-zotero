import { config } from "./constants";

const PANEL_ID = `${config.addonRef}-reader-context-panel`;
const BUTTON_ID = `${config.addonRef}-reader-context-button`;
const BUTTON_WRAPPER_ID = `${config.addonRef}-reader-context-button-wrapper`;

export type ReaderContextPaneRenderer = {
  render: (body: Element, item: Zotero.Item | null) => void;
  renderAsync: (body: Element, item: Zotero.Item | null) => Promise<void>;
  onItemChange?: (item: Zotero.Item | null) => void;
  dispose?: (body: Element) => void;
};

type ReaderTab = {
  type?: string;
  data?: { itemID?: string | number };
};

type ReaderTabs = {
  selectedID?: string | number;
  selectedType?: string;
  _getTab?: (id: string | number) => { tab?: ReaderTab } | undefined;
};

type NativeDeck = Element & {
  selectedPanel?: Element | null;
};

type PaneState = {
  win: _ZoteroTypes.MainWindow;
  panel: HTMLDivElement;
  button: HTMLDivElement;
  wrapper: HTMLDivElement;
  deck: NativeDeck;
  renderer: ReaderContextPaneRenderer;
  notifierID: string | null;
  shouldRemainVisible: boolean;
  disposed: boolean;
  onNativePaneSelect: (event: Event) => void;
  onWindowUnload: () => void;
};

type TabEventData = Record<
  string,
  { type?: string; [key: string]: unknown } | undefined
>;

const states = new WeakMap<Window, PaneState>();

function getWindowTabs(win: Window): ReaderTabs | null {
  const windowWithTabs = win as Window & {
    Zotero_Tabs?: ReaderTabs;
    Zotero?: { Tabs?: ReaderTabs };
  };
  return windowWithTabs.Zotero_Tabs || windowWithTabs.Zotero?.Tabs || null;
}

function isReaderTab(tab: ReaderTab | null | undefined): boolean {
  return `${tab?.type || ""}`.toLowerCase().includes("reader");
}

function getSelectedReaderItem(win: Window): Zotero.Item | null {
  const tabs = getWindowTabs(win);
  const tabID = tabs?.selectedID;
  if (tabID === undefined || tabID === null) return null;
  const tab = tabs?._getTab?.(tabID)?.tab || null;
  if (!isReaderTab(tab)) return null;
  const itemID = Math.floor(Number(tab?.data?.itemID || 0));
  const item = itemID > 0 ? Zotero.Items.get(itemID) || null : null;
  // Match Zotero's own reader ContextPane: the item-details surface is owned
  // by the parent paper while active-reader attachment resolution supplies
  // the current PDF/text source beneath it.
  if (item?.isAttachment?.() && item.parentID) {
    return Zotero.Items.get(item.parentID) || item;
  }
  return item;
}

function isSelectedReaderTab(win: Window): boolean {
  const tabs = getWindowTabs(win);
  if (`${tabs?.selectedType || ""}`.toLowerCase().includes("reader")) {
    return true;
  }
  const tabID = tabs?.selectedID;
  return tabID !== undefined && tabID !== null
    ? isReaderTab(tabs?._getTab?.(tabID)?.tab)
    : false;
}

function updateButtonState(state: PaneState): void {
  const selected = state.deck.selectedPanel === state.panel;
  state.button.classList.toggle("selected", selected);
  state.button.setAttribute("aria-selected", selected ? "true" : "false");
}

function renderSelectedReader(state: PaneState): void {
  if (state.disposed) return;
  const tabID = getWindowTabs(state.win)?.selectedID;
  state.panel.dataset.readerTabId =
    tabID === undefined || tabID === null ? "" : `${tabID}`;
  const item = getSelectedReaderItem(state.win);
  state.renderer.onItemChange?.(item);
  state.renderer.render(state.panel, item);
  void state.renderer.renderAsync(state.panel, item).catch((error) => {
    ztoolkit.log("LLM: reader context pane async render failed", error);
  });
}

function showPane(state: PaneState): void {
  if (state.disposed || !isSelectedReaderTab(state.win)) return;
  state.shouldRemainVisible = true;
  renderSelectedReader(state);
  state.deck.selectedPanel = state.panel;
  updateButtonState(state);
  try {
    const contextPane = (
      state.win as unknown as {
        ZoteroContextPane?: {
          collapsed?: boolean;
          update?: () => void;
        };
      }
    ).ZoteroContextPane;
    if (contextPane) contextPane.collapsed = false;
    contextPane?.update?.();
  } catch {
    // The pane is still usable if Zotero's optional layout refresh is absent.
  }
}

export function shouldDefaultOpenReaderPaneForTabEvent(options: {
  event: string;
  type: string;
  ids: Array<string | number>;
  selectedTabID: string | number | null | undefined;
  extraData?: TabEventData;
}): boolean {
  if (options.type !== "tab" || options.event !== "load") return false;
  const tabID = options.ids[0];
  if (tabID === undefined || tabID === null) return false;
  if (`${tabID}` !== `${options.selectedTabID ?? ""}`) return false;
  return isReaderTab(options.extraData?.[`${tabID}`]);
}

function createPanel(doc: Document): HTMLDivElement {
  const panel = doc.createXULElement("vbox") as unknown as HTMLDivElement;
  panel.id = PANEL_ID;
  panel.className = "zotero-item-pane-content llm-reader-context-pane";
  panel.dataset.llmReaderContextPane = "true";
  panel.setAttribute("flex", "1");
  panel.style.width = "100%";
  panel.style.height = "100%";
  panel.style.minWidth = "0";
  panel.style.minHeight = "0";
  return panel;
}

function createSidenavButton(doc: Document): {
  button: HTMLDivElement;
  wrapper: HTMLDivElement;
} {
  const wrapper = doc.createElement("div");
  wrapper.id = BUTTON_WRAPPER_ID;
  wrapper.className = "pin-wrapper llm-reader-context-button-wrapper";
  const button = doc.createElement("div");
  button.id = BUTTON_ID;
  button.className = "btn llm-reader-context-button";
  button.setAttribute("role", "tab");
  button.setAttribute("tabindex", "0");
  button.setAttribute("title", "llm-for-zotero");
  button.setAttribute("aria-label", "llm-for-zotero");
  wrapper.append(button);
  return { button, wrapper };
}

function getSidenavButtonContainer(doc: Document): Element | null {
  const sidenav = doc.getElementById("zotero-context-pane-sidenav");
  return sidenav?.querySelector(".inherit-flex") || null;
}

function scheduleRestoreAfterTabSwitch(state: PaneState): void {
  if (!state.shouldRemainVisible || !isSelectedReaderTab(state.win)) return;
  state.win.setTimeout(() => showPane(state), 0);
}

/**
 * Installs the chat as a third top-level ContextPane deck view.  It deliberately
 * does not set `data-pane`: Zotero's ItemPaneManager would otherwise treat it
 * as a scroll-to-section button and put the chat back in the item-details flow.
 */
export function registerIndependentReaderContextPane(
  win: _ZoteroTypes.MainWindow,
  renderer: ReaderContextPaneRenderer,
): void {
  if (states.has(win)) return;
  const doc = win.document;
  const deck = doc.getElementById(
    "zotero-context-pane-deck",
  ) as NativeDeck | null;
  const sidenavContainer = getSidenavButtonContainer(doc);
  if (!deck || !sidenavContainer) {
    ztoolkit.log("LLM: reader context pane host unavailable");
    return;
  }

  const existingPanel = doc.getElementById(PANEL_ID) as HTMLDivElement | null;
  const existingButton = doc.getElementById(BUTTON_ID) as HTMLDivElement | null;
  const existingWrapper = doc.getElementById(
    BUTTON_WRAPPER_ID,
  ) as HTMLDivElement | null;
  const panel = existingPanel || createPanel(doc);
  const { button, wrapper } =
    existingButton && existingWrapper
      ? { button: existingButton, wrapper: existingWrapper }
      : createSidenavButton(doc);
  if (!panel.isConnected) deck.append(panel);
  if (!wrapper.isConnected) sidenavContainer.append(wrapper);

  const state: PaneState = {
    win,
    panel,
    button,
    wrapper,
    deck,
    renderer,
    notifierID: null,
    shouldRemainVisible: deck.selectedPanel === panel,
    disposed: false,
    onNativePaneSelect: (event) => {
      const target = event.target as Element | null;
      const nativeButton = target?.closest?.(
        ".btn[data-pane], .highlight-notes-active",
      );
      if (!nativeButton || nativeButton.contains(button)) return;
      // ItemPaneSidenav only scrolls an item-details section. Its regular
      // button handler does not select the top-level item deck, because it
      // normally already is selected. Restore that invariant before Zotero
      // performs its native scroll-to-section work.
      const paneID = nativeButton
        .querySelector?.(".btn[data-pane]")
        ?.getAttribute("data-pane") ||
        nativeButton.getAttribute?.("data-pane");
      if (paneID !== "context-notes") {
        const itemDeck = doc.getElementById("zotero-context-pane-item-deck");
        if (itemDeck) deck.selectedPanel = itemDeck;
      }
      state.shouldRemainVisible = false;
      updateButtonState(state);
    },
    onWindowUnload: () => unregisterIndependentReaderContextPane(win),
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showPane(state);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    showPane(state);
  });
  // Clicking any built-in ItemPane/notes button means the reader chose a
  // different ContextPane view.  There is intentionally no auto-open here.
  const sidenav = doc.getElementById("zotero-context-pane-sidenav");
  sidenav?.addEventListener("click", state.onNativePaneSelect, true);
  win.addEventListener("unload", state.onWindowUnload, { once: true });

  state.notifierID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids, extraData) {
        if (type !== "tab" || !["select", "load"].includes(event)) return;
        if (
          shouldDefaultOpenReaderPaneForTabEvent({
            event,
            type,
            ids,
            selectedTabID: getWindowTabs(state.win)?.selectedID,
            extraData: extraData as TabEventData,
          })
        ) {
          state.win.setTimeout(() => showPane(state), 0);
          return;
        }
        scheduleRestoreAfterTabSwitch(state);
      },
    },
    ["tab"],
    `${config.addonRef}-reader-context-${Date.now()}-${Math.random()}`,
    30,
  );
  states.set(win, state);
  updateButtonState(state);
  // When Zotero starts with a reader already selected, there is no later
  // `tab/load` event for the plugin to observe. Treat startup as the initial
  // open so the reader still lands in llm-for-zotero by default.
  if (isSelectedReaderTab(win)) {
    win.setTimeout(() => showPane(state), 0);
  }
}

export function unregisterIndependentReaderContextPane(win: Window): void {
  const state = states.get(win);
  if (!state) return;
  state.disposed = true;
  if (state.notifierID) Zotero.Notifier.unregisterObserver(state.notifierID);
  const sidenav = state.win.document.getElementById(
    "zotero-context-pane-sidenav",
  );
  sidenav?.removeEventListener("click", state.onNativePaneSelect, true);
  state.win.removeEventListener("unload", state.onWindowUnload);
  state.renderer.dispose?.(state.panel);
  state.wrapper.remove();
  state.panel.remove();
  states.delete(win);
}

export function unregisterAllIndependentReaderContextPanes(): void {
  for (const win of Zotero.getMainWindows?.() || []) {
    unregisterIndependentReaderContextPane(win);
  }
}

export function isIndependentReaderContextPane(element: Element | null): boolean {
  return Boolean(
    element?.closest?.(`[data-llm-reader-context-pane="true"]`),
  );
}
