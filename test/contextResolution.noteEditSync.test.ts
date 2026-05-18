import { assert } from "chai";
import {
  getSelectedTextContextEntries,
  resolveContextSourceItemId,
  setSelectedTextContextEntries,
  syncSelectedTextContextForSource,
} from "../src/modules/contextPanel/contextResolution";

describe("contextResolution note-edit sync", function () {
  const itemId = 777;
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
  };
  const originalZotero = globalScope.Zotero;

  afterEach(function () {
    setSelectedTextContextEntries(itemId, []);
    globalScope.Zotero = originalZotero;
  });

  it("adds and removes transient note-edit context without dropping manual contexts", function () {
    setSelectedTextContextEntries(itemId, [
      { text: "PDF snippet", source: "pdf", pageIndex: 1, pageLabel: "2" },
      { text: "Model snippet", source: "model" },
    ]);

    assert.isTrue(
      syncSelectedTextContextForSource(itemId, "Edit this sentence", "note-edit"),
    );
    assert.deepEqual(
      getSelectedTextContextEntries(itemId).map((entry) => ({
        text: entry.text,
        source: entry.source,
      })),
      [
        { text: "Edit this sentence", source: "note-edit" },
        { text: "PDF snippet", source: "pdf" },
        { text: "Model snippet", source: "model" },
      ],
    );

    assert.isTrue(syncSelectedTextContextForSource(itemId, "", "note-edit"));
    assert.deepEqual(
      getSelectedTextContextEntries(itemId).map((entry) => ({
        text: entry.text,
        source: entry.source,
      })),
      [
        { text: "PDF snippet", source: "pdf" },
        { text: "Model snippet", source: "model" },
      ],
    );
  });

  it("does not rewrite state when the note-edit focus is unchanged", function () {
    assert.isTrue(
      syncSelectedTextContextForSource(itemId, "Tighten this wording", "note-edit"),
    );
    assert.isFalse(
      syncSelectedTextContextForSource(itemId, "Tighten this wording", "note-edit"),
    );
  });

  it("resolves library-view context source by selected child attachment", function () {
    const parentItem = {
      id: 100,
      isAttachment: () => false,
      isRegularItem: () => true,
      getAttachments: () => [101, 102],
      getField: () => "Parent Paper",
    };
    const mainPdf = {
      id: 101,
      parentID: 100,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "Main PDF",
    };
    const supplementPdf = {
      id: 102,
      parentID: 100,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "Supplement PDF",
    };
    const items = new Map<number, unknown>([
      [100, parentItem],
      [101, mainPdf],
      [102, supplementPdf],
    ]);
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => items.get(id) || null,
      },
      Tabs: {
        selectedType: "library",
        selectedID: "library",
        _tabs: [],
      },
    };

    assert.equal(
      resolveContextSourceItemId(mainPdf as unknown as Zotero.Item),
      101,
    );
    assert.equal(
      resolveContextSourceItemId(supplementPdf as unknown as Zotero.Item),
      102,
    );
    assert.equal(
      resolveContextSourceItemId(parentItem as unknown as Zotero.Item),
      101,
    );
  });

  it("uses the library-pane selected child PDF before first-child fallback", function () {
    const parentItem = {
      id: 150,
      isAttachment: () => false,
      isRegularItem: () => true,
      getAttachments: () => [151, 152],
      getField: () => "Parent Paper",
    };
    const mainPdf = {
      id: 151,
      parentID: 150,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "Main PDF",
    };
    const selectedPdf = {
      id: 152,
      parentID: 150,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "PDF",
    };
    const items = new Map<number, unknown>([
      [150, parentItem],
      [151, mainPdf],
      [152, selectedPdf],
    ]);
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => items.get(id) || null,
      },
      Tabs: {
        selectedType: "library",
        selectedID: "library",
        _tabs: [],
      },
      getActiveZoteroPane: () => ({
        getSelectedItems: () => [selectedPdf],
      }),
    };

    assert.equal(
      resolveContextSourceItemId(parentItem as unknown as Zotero.Item),
      152,
    );
  });

  it("uses the active reader attachment over the parent item source", function () {
    const parentItem = {
      id: 200,
      isAttachment: () => false,
      isRegularItem: () => true,
      getAttachments: () => [201],
      getField: () => "Parent Paper",
    };
    const mainPdf = {
      id: 201,
      parentID: 200,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "Main PDF",
    };
    const activeReaderPdf = {
      id: 202,
      parentID: 200,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isRegularItem: () => false,
      getField: () => "Active Reader PDF",
    };
    const items = new Map<number, unknown>([
      [200, parentItem],
      [201, mainPdf],
      [202, activeReaderPdf],
    ]);
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => items.get(id) || null,
      },
      Tabs: {
        selectedType: "reader",
        selectedID: "reader-tab",
        _tabs: [
          {
            id: "reader-tab",
            type: "reader",
            data: { itemID: 202 },
          },
        ],
      },
    };

    assert.equal(
      resolveContextSourceItemId(parentItem as unknown as Zotero.Item),
      202,
    );
  });

  it("refreshes note-backed text contexts from the current note snapshot", function () {
    const noteItem = {
      id: 501,
      key: "ABCD1234",
      libraryID: 1,
      isNote: () => true,
      getNote: () => "<p>Updated note body</p>",
      getDisplayTitle: () => "Context note",
    };
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => (id === 501 ? noteItem : null),
        getByLibraryAndKey: (libraryID: number, key: string) =>
          libraryID === 1 && key === "ABCD1234" ? noteItem : null,
      },
    };

    setSelectedTextContextEntries(itemId, [
      {
        text: "Stale note body",
        source: "note",
        noteContext: {
          libraryID: 1,
          noteItemKey: "ABCD1234",
          noteKind: "standalone",
          title: "Old title",
        },
      },
    ]);

    const entries = getSelectedTextContextEntries(itemId);
    assert.deepEqual(entries, [
      {
        text: "Updated note body",
        source: "note",
        noteContext: {
          libraryID: 1,
          noteItemKey: "ABCD1234",
          noteItemId: 501,
          parentItemId: undefined,
          parentItemKey: undefined,
          noteKind: "standalone",
          title: "Context note",
        },
        paperContext: undefined,
        contextItemId: undefined,
        pageIndex: undefined,
        pageLabel: undefined,
      },
    ]);
  });
});
