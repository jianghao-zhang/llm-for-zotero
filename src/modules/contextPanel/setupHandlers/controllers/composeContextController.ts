import { normalizePaperContextRefs } from "../../normalizers";
import { sanitizeText } from "../../textUtils";
import { resolvePaperContextDisplayMetadata as resolvePaperContextDisplayMetadataShared } from "../../paperAttribution";
import type { PaperContextRef, PaperContentSourceMode } from "../../types";

export function normalizePaperContextEntries(
  value: unknown,
): PaperContextRef[] {
  return normalizePaperContextRefs(value, { sanitizeText });
}

export function resolvePaperContextDisplayMetadata(
  paperContext: PaperContextRef,
): {
  firstCreator?: string;
  year?: string;
} {
  return resolvePaperContextDisplayMetadataShared(paperContext);
}

function extractPaperYear(paperContext: PaperContextRef): string | null {
  return resolvePaperContextDisplayMetadata(paperContext).year || null;
}

function normalizeAttachmentText(value: unknown): string {
  return sanitizeText(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function getZoteroItemsApi(): {
  get?: (itemId: number) => Zotero.Item | null | undefined;
} | null {
  if (typeof Zotero === "undefined") return null;
  return (
    (
      Zotero as unknown as {
        Items?: { get?: (itemId: number) => Zotero.Item | null | undefined };
      }
    ).Items || null
  );
}

function resolvePaperContextAttachmentItem(
  paperContext: PaperContextRef,
): Zotero.Item | null {
  const attachment =
    getZoteroItemsApi()?.get?.(paperContext.contextItemId) || null;
  if (!attachment?.isAttachment?.()) return null;
  return attachment;
}

function resolvePaperContextParentItem(
  paperContext: PaperContextRef,
): Zotero.Item | null {
  const items = getZoteroItemsApi();
  const item = items?.get?.(paperContext.itemId) || null;
  if (item?.isRegularItem?.()) return item;
  const contextAttachment = resolvePaperContextAttachmentItem(paperContext);
  if (contextAttachment?.parentID) {
    const parent = items?.get?.(contextAttachment.parentID) || null;
    if (parent?.isRegularItem?.()) return parent;
  }
  return null;
}

/** Returns the attachment title for any paper context (always, not just multi-PDF). */
export function resolveAttachmentTitle(paperContext: PaperContextRef): string {
  return (
    resolveLiveAttachmentTitle(paperContext) ||
    normalizeAttachmentText(paperContext.attachmentTitle || "")
  );
}

function resolveLiveAttachmentTitle(paperContext: PaperContextRef): string {
  const contextAttachment = resolvePaperContextAttachmentItem(paperContext);
  if (contextAttachment) {
    const title = normalizeAttachmentText(contextAttachment.getField("title"));
    if (title) return title;
  }
  return "";
}

function resolveAttachmentFilename(paperContext: PaperContextRef): string {
  const contextAttachment = resolvePaperContextAttachmentItem(paperContext);
  if (!contextAttachment) return "";
  return normalizeAttachmentText(
    (contextAttachment as unknown as { attachmentFilename?: unknown })
      .attachmentFilename,
  );
}

export function resolvePaperContextAttachmentLabel(
  paperContext: PaperContextRef,
  options?: { fallback?: string },
): string {
  return (
    resolveLiveAttachmentTitle(paperContext) ||
    resolveAttachmentFilename(paperContext) ||
    normalizeAttachmentText(paperContext.attachmentTitle || "") ||
    normalizeAttachmentText(options?.fallback || "")
  );
}

function resolveMultiPdfAttachmentTitle(paperContext: PaperContextRef): string {
  const parentItem = resolvePaperContextParentItem(paperContext);
  if (!parentItem) return "";
  const attachmentIds = parentItem.getAttachments?.() || [];
  let pdfCount = 0;
  for (const attachmentId of attachmentIds) {
    const attachment = getZoteroItemsApi()?.get?.(attachmentId);
    if (
      attachment?.isAttachment?.() &&
      attachment.attachmentContentType === "application/pdf"
    ) {
      pdfCount += 1;
    }
  }
  if (pdfCount <= 1) return "";
  return resolveAttachmentTitle(paperContext);
}

function buildCreatorYearBase(paperContext: PaperContextRef): string {
  const metadata = resolvePaperContextDisplayMetadata(paperContext);
  const creator = sanitizeText(metadata.firstCreator || "").trim();
  const year = extractPaperYear(paperContext);
  return creator ? (year ? `${creator}, ${year}` : creator) : "Paper";
}

export function formatPaperContextChipLabel(
  paperContext: PaperContextRef,
  contentSourceMode?: PaperContentSourceMode,
): string {
  const base = buildCreatorYearBase(paperContext);
  if (contentSourceMode === "text") return `${base} - Text`;
  if (contentSourceMode === "mineru") return `${base} - MD`;
  if (contentSourceMode === "pdf") return `${base} - PDF`;
  if (contentSourceMode === "markdown") return `${base} - MD`;
  if (contentSourceMode === "html") return `${base} - HTML`;
  if (contentSourceMode === "txt") return `${base} - TXT`;
  if (contentSourceMode === "docx") return `${base} - DOCX`;
  // Fallback (no mode specified) — legacy behavior
  const attachmentTitle = resolveMultiPdfAttachmentTitle(paperContext);
  return attachmentTitle ? `${base} - ${attachmentTitle}` : base;
}

export function formatPaperContextCardAttachmentLine(
  paperContext: PaperContextRef,
  contentSourceMode?: PaperContentSourceMode,
): string {
  if (contentSourceMode === "pdf") {
    return resolvePaperContextAttachmentLabel(paperContext);
  }
  if (contentSourceMode === "mineru") {
    return resolvePaperContextAttachmentLabel(paperContext, {
      fallback: "full.md",
    });
  }
  if (
    contentSourceMode === "markdown" ||
    contentSourceMode === "html" ||
    contentSourceMode === "txt" ||
    contentSourceMode === "docx"
  ) {
    return resolvePaperContextAttachmentLabel(paperContext);
  }
  return "";
}

export function formatPaperContextChipTitle(
  paperContext: PaperContextRef,
  contentSourceMode?: PaperContentSourceMode,
): string {
  const metadata = resolvePaperContextDisplayMetadata(paperContext);
  const meta = [metadata.firstCreator || "", metadata.year || ""]
    .filter(Boolean)
    .join(" · ");
  const modeLabel =
    contentSourceMode === "text"
      ? "Source: Extracted text"
      : contentSourceMode === "mineru"
        ? "Source: MinerU (enhanced markdown)"
        : contentSourceMode === "pdf"
          ? "Source: PDF file"
          : contentSourceMode === "markdown"
            ? "Source: Markdown attachment"
            : contentSourceMode === "html"
              ? "Source: HTML attachment"
              : contentSourceMode === "txt"
                ? "Source: TXT attachment"
                : contentSourceMode === "docx"
                  ? "Source: Word attachment"
                  : "";
  const attachmentTitle = formatPaperContextCardAttachmentLine(
    paperContext,
    contentSourceMode,
  );
  return [
    paperContext.title,
    meta,
    attachmentTitle ? `Attachment: ${attachmentTitle}` : "",
    modeLabel,
  ]
    .filter(Boolean)
    .join("\n");
}
