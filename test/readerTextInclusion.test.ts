import { assert } from "chai";
import {
  appendSelectedTextContextForItem,
  getSelectedTextContextEntries,
  updateSelectedTextContextCommentForItem,
} from "../src/modules/contextPanel/contextResolution";
import {
  includeReaderSelectedText,
  updateReaderSelectedTextComment,
  type ReaderTextInclusionDependencies,
} from "../src/modules/contextPanel/readerTextInclusion";
import {
  activeContextPanels,
  activeContextPanelStateSync,
  clearAllState,
} from "../src/modules/contextPanel/state";

type FakeStatus = {
  textContent: string;
  className: string;
};

type FakeInput = {
  focused: boolean;
  focus: (options?: FocusOptions) => void;
};

function fakePanelBody(
  conversationKey: number,
  connected: boolean = true,
): {
  body: Element;
  status: FakeStatus;
  input: FakeInput;
} {
  const root = {
    dataset: { itemId: `${conversationKey}` },
  };
  const status: FakeStatus = { textContent: "", className: "" };
  const input: FakeInput = {
    focused: false,
    focus: () => {
      input.focused = true;
    },
  };
  const body = {
    isConnected: connected,
    querySelector: (selector: string) => {
      if (selector === "#llm-main") return root;
      if (selector === "#llm-status") return status;
      if (selector === "#llm-input") return input;
      return null;
    },
  } as unknown as Element;
  return { body, status, input };
}

function noLocationDependencies(
  resolveLocation: ReaderTextInclusionDependencies["resolveLocation"],
): ReaderTextInclusionDependencies {
  return {
    getCurrentLocation: () => null,
    resolveLocation,
  };
}

describe("reader text inclusion", function () {
  afterEach(function () {
    clearAllState();
  });

  it("commits text immediately and enriches its page in the background", async function () {
    const conversationKey = 8101;
    const panel = fakePanelBody(conversationKey);
    let syncCount = 0;
    activeContextPanelStateSync.set(panel.body, () => {
      syncCount += 1;
    });

    let resolveLocation!: (
      value: Awaited<
        ReturnType<ReaderTextInclusionDependencies["resolveLocation"]>
      >,
    ) => void;
    const locationPromise = new Promise<
      Awaited<ReturnType<ReaderTextInclusionDependencies["resolveLocation"]>>
    >((resolve) => {
      resolveLocation = resolve;
    });
    const command = includeReaderSelectedText(
      {
        body: panel.body,
        conversationKey,
        selectedText: "deferred page location",
        reader: { itemID: 42 },
      },
      noLocationDependencies(() => locationPromise),
    );

    assert.lengthOf(getSelectedTextContextEntries(conversationKey), 1);
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      text: "deferred page location",
      source: "pdf",
      contextItemId: 42,
    });
    assert.equal(syncCount, 1);
    assert.equal(panel.status.textContent, "Selected text included");
    assert.isTrue(panel.input.focused);

    resolveLocation({
      contextItemId: 42,
      pageIndex: 3,
      pageLabel: "431",
      pagesScanned: 8,
    });
    const result = await command;

    assert.equal(result.outcome, "added");
    assert.isTrue(result.locationEnriched);
    assert.equal(syncCount, 2);
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      contextItemId: 42,
      pageIndex: 3,
      pageLabel: "431",
    });
  });

  it("uses a prefetched location without running either locator", async function () {
    const conversationKey = 8102;
    const panel = fakePanelBody(conversationKey);
    activeContextPanelStateSync.set(panel.body, () => undefined);

    const result = await includeReaderSelectedText(
      {
        body: panel.body,
        conversationKey,
        selectedText: "cached pointer-down selection",
        reader: { itemID: 43 },
        initialLocation: {
          contextItemId: 43,
          pageIndex: 2,
          pageLabel: "17",
        },
      },
      {
        getCurrentLocation: () => {
          throw new Error("direct locator should not run");
        },
        resolveLocation: async () => {
          throw new Error("async locator should not run");
        },
      },
    );

    assert.equal(result.outcome, "added");
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      contextItemId: 43,
      pageIndex: 2,
      pageLabel: "17",
    });
  });

  it("keeps focus in the popup and attaches an optional comment", async function () {
    const conversationKey = 8107;
    const panel = fakePanelBody(conversationKey);
    let syncCount = 0;
    activeContextPanelStateSync.set(panel.body, () => {
      syncCount += 1;
    });

    const result = await includeReaderSelectedText({
      body: panel.body,
      conversationKey,
      selectedText: "The interaction should stay fluid.",
      initialLocation: { contextItemId: 47, pageIndex: 4 },
      focusPanelInput: false,
    });
    const updated = updateReaderSelectedTextComment({
      body: panel.body,
      conversationKey,
      selectedText: "The interaction should stay fluid.",
      comment: "How does this support the central claim?",
    });

    assert.isTrue(result.added);
    assert.isFalse(panel.input.focused);
    assert.isTrue(updated);
    assert.equal(syncCount, 2);
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      text: "The interaction should stay fluid.",
      comment: "How does this support the central claim?",
    });
  });

  it("attaches a comment to the matching quoted model response", function () {
    const conversationKey = 8108;
    appendSelectedTextContextForItem(
      conversationKey,
      "Quoted assistant response",
      "model",
    );
    appendSelectedTextContextForItem(
      conversationKey,
      "Quoted assistant response",
      "pdf",
    );

    const updated = updateSelectedTextContextCommentForItem(
      conversationKey,
      "Quoted assistant response",
      "Compare this claim with the source evidence.",
      "model",
    );

    assert.isTrue(updated);
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      source: "model",
      comment: "Compare this claim with the source evidence.",
    });
    assert.notProperty(
      getSelectedTextContextEntries(conversationKey)[1] || {},
      "comment",
    );
  });

  it("keeps captured text when asynchronous page lookup fails", async function () {
    const conversationKey = 8103;
    const panel = fakePanelBody(conversationKey);
    const logs: string[] = [];
    activeContextPanelStateSync.set(panel.body, () => undefined);

    const result = await includeReaderSelectedText(
      {
        body: panel.body,
        conversationKey,
        selectedText: "text survives locator failure",
        reader: { itemID: 44 },
        log: (message) => logs.push(message),
      },
      noLocationDependencies(async () => {
        throw new Error("locator unavailable");
      }),
    );

    assert.equal(result.outcome, "added");
    assert.isFalse(result.locationEnriched);
    assert.deepInclude(getSelectedTextContextEntries(conversationKey)[0], {
      text: "text survives locator failure",
      contextItemId: 44,
    });
    assert.include(logs, "LLM addText: page-location enrichment failed");
  });

  it("refreshes matching live panels and removes disconnected registrations", async function () {
    const conversationKey = 8104;
    const primary = fakePanelBody(conversationKey);
    const matching = fakePanelBody(conversationKey);
    const unrelated = fakePanelBody(9999);
    const disconnected = fakePanelBody(conversationKey, false);
    const refreshed: string[] = [];
    activeContextPanelStateSync.set(primary.body, () =>
      refreshed.push("primary"),
    );
    activeContextPanelStateSync.set(matching.body, () =>
      refreshed.push("matching"),
    );
    activeContextPanelStateSync.set(unrelated.body, () =>
      refreshed.push("unrelated"),
    );
    activeContextPanelStateSync.set(disconnected.body, () =>
      refreshed.push("disconnected"),
    );
    activeContextPanels.set(disconnected.body, () => null);

    await includeReaderSelectedText({
      body: primary.body,
      conversationKey,
      selectedText: "shared panel refresh",
      initialLocation: { contextItemId: 45, pageIndex: 0 },
    });

    assert.deepEqual(refreshed, ["primary", "matching"]);
    assert.isFalse(activeContextPanels.has(disconnected.body));
    assert.isFalse(activeContextPanelStateSync.has(disconnected.body));
  });

  it("reports no selection and invalid targets without mutating context", async function () {
    const panel = fakePanelBody(8105);

    const noSelection = await includeReaderSelectedText({
      body: panel.body,
      conversationKey: 8105,
      selectedText: "  ",
    });
    const invalidTarget = await includeReaderSelectedText({
      body: panel.body,
      conversationKey: 0,
      selectedText: "valid text",
    });

    assert.equal(noSelection.outcome, "no-selection");
    assert.equal(panel.status.textContent, "Select text in the reader first");
    assert.equal(invalidTarget.outcome, "invalid-target");
    assert.deepEqual(getSelectedTextContextEntries(8105), []);
  });

  it("rejects duplicates while allowing unlimited distinct selections", async function () {
    const conversationKey = 8106;
    const panel = fakePanelBody(conversationKey);
    activeContextPanelStateSync.set(panel.body, () => undefined);
    appendSelectedTextContextForItem(
      conversationKey,
      "duplicate selection",
      "pdf",
      null,
      { contextItemId: 46, pageIndex: 0 },
    );

    const duplicate = await includeReaderSelectedText({
      body: panel.body,
      conversationKey,
      selectedText: "duplicate selection",
      initialLocation: { contextItemId: 46, pageIndex: 0 },
    });
    assert.equal(duplicate.outcome, "not-added");
    assert.equal(panel.status.textContent, "Text context already included");
    for (let index = 1; index <= 8; index++) {
      appendSelectedTextContextForItem(
        conversationKey,
        `selection ${index}`,
        "pdf",
        null,
        { contextItemId: 46, pageIndex: index },
      );
    }
    const tenthSelection = await includeReaderSelectedText({
      body: panel.body,
      conversationKey,
      selectedText: "selection 9",
      initialLocation: { contextItemId: 46, pageIndex: 9 },
    });

    assert.equal(tenthSelection.outcome, "added");
    assert.equal(panel.status.textContent, "Selected text included");
    assert.lengthOf(getSelectedTextContextEntries(conversationKey), 10);
  });
});
