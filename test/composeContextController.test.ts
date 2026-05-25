import { assert } from "chai";
import type { PaperContextRef } from "../src/modules/contextPanel/types";
import {
  formatPaperContextCardAttachmentLine,
  formatPaperContextChipLabel,
  formatPaperContextChipTitle,
  resolvePaperContextAttachmentLabel,
} from "../src/modules/contextPanel/setupHandlers/controllers/composeContextController";

type MockAttachment = Zotero.Item & {
  titleText: string;
  attachmentFilename?: string;
};

const zoteroItems = new Map<number, Zotero.Item>();

function makeAttachment(options: {
  id: number;
  title?: string;
  filename?: string;
  parentID?: number;
}): MockAttachment {
  return {
    id: options.id,
    parentID: options.parentID ?? 1,
    titleText: options.title || "",
    attachmentContentType: "application/pdf",
    attachmentFilename: options.filename || "",
    isAttachment: () => true,
    isRegularItem: () => false,
    getField(field: string) {
      return field === "title" ? this.titleText : "";
    },
    getAttachments: () => [],
  } as unknown as MockAttachment;
}

function makePaperContext(options: {
  itemId?: number;
  contextItemId: number;
  attachmentTitle?: string;
}): PaperContextRef {
  return {
    itemId: options.itemId ?? 1,
    contextItemId: options.contextItemId,
    title: "Directional dynamics in the entorhinal cortex",
    attachmentTitle: options.attachmentTitle,
    firstCreator: "Liu et al.",
    year: "2026",
  };
}

describe("composeContextController paper card attachment labels", function () {
  const originalZotero = globalThis.Zotero;

  beforeEach(function () {
    zoteroItems.clear();
    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
      Items: {
        get(id: number) {
          return zoteroItems.get(id) || null;
        },
      },
    } as unknown as typeof Zotero;
  });

  after(function () {
    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero =
      originalZotero;
  });

  it("shows the live attachment title for MinerU cards and tooltips", function () {
    zoteroItems.set(
      101,
      makeAttachment({
        id: 101,
        title: "Supplementary Material",
        filename: "supplement.pdf",
      }),
    );
    const paperContext = makePaperContext({
      contextItemId: 101,
      attachmentTitle: "Stored Attachment",
    });

    assert.equal(
      formatPaperContextCardAttachmentLine(paperContext, "mineru"),
      "Supplementary Material",
    );
    const tooltip = formatPaperContextChipTitle(paperContext, "mineru");
    assert.include(tooltip, "Attachment: Supplementary Material");
    assert.notInclude(tooltip, "full.md");
  });

  it("formats named source badges for text-like child attachments", function () {
    const paperContext = makePaperContext({
      contextItemId: 101,
      attachmentTitle: "notes.docx",
    });

    assert.equal(
      formatPaperContextChipLabel(paperContext, "html"),
      "Liu et al., 2026 - HTML",
    );
    assert.equal(
      formatPaperContextChipLabel(paperContext, "txt"),
      "Liu et al., 2026 - TXT",
    );
    assert.equal(
      formatPaperContextChipLabel(paperContext, "docx"),
      "Liu et al., 2026 - DOCX",
    );
    assert.include(formatPaperContextChipTitle(paperContext, "docx"), "Word");
  });

  it("falls back to filename before stale stored attachment title", function () {
    zoteroItems.set(
      102,
      makeAttachment({
        id: 102,
        title: "",
        filename: "41467_2026_70289_MOESM1_ESM.pdf",
      }),
    );
    const paperContext = makePaperContext({
      contextItemId: 102,
      attachmentTitle: "Old Supplement Title",
    });

    assert.equal(
      resolvePaperContextAttachmentLabel(paperContext, { fallback: "full.md" }),
      "41467_2026_70289_MOESM1_ESM.pdf",
    );
  });

  it("distinguishes two attachments under the same parent item", function () {
    zoteroItems.set(
      201,
      makeAttachment({ id: 201, title: "Main Article PDF", parentID: 1 }),
    );
    zoteroItems.set(
      202,
      makeAttachment({
        id: 202,
        title: "Supplementary Figures PDF",
        parentID: 1,
      }),
    );

    assert.equal(
      formatPaperContextCardAttachmentLine(
        makePaperContext({ contextItemId: 201 }),
        "mineru",
      ),
      "Main Article PDF",
    );
    assert.equal(
      formatPaperContextCardAttachmentLine(
        makePaperContext({ contextItemId: 202 }),
        "mineru",
      ),
      "Supplementary Figures PDF",
    );
  });

  it("reflects a renamed Zotero attachment on the next render", function () {
    const attachment = makeAttachment({
      id: 301,
      title: "Original Supplement Title",
    });
    zoteroItems.set(301, attachment);
    const paperContext = makePaperContext({
      contextItemId: 301,
      attachmentTitle: "Original Supplement Title",
    });

    assert.equal(
      formatPaperContextCardAttachmentLine(paperContext, "mineru"),
      "Original Supplement Title",
    );

    attachment.titleText = "Renamed Supplement Title";

    assert.equal(
      formatPaperContextCardAttachmentLine(paperContext, "mineru"),
      "Renamed Supplement Title",
    );
  });

  it("falls back to stored context data, then full.md, when lookup fails", function () {
    const storedContext = makePaperContext({
      contextItemId: 404,
      attachmentTitle: "Stored Supplement Title",
    });
    assert.equal(
      formatPaperContextCardAttachmentLine(storedContext, "mineru"),
      "Stored Supplement Title",
    );

    const missingContext = makePaperContext({ contextItemId: 405 });
    assert.equal(
      formatPaperContextCardAttachmentLine(missingContext, "mineru"),
      "full.md",
    );
  });
});
