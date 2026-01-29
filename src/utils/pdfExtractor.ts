/**
 * PDF text extraction utilities for Zotero items
 */

const MAX_CONTENT_LENGTH = 15000; // Limit context size to avoid token limits

export type DocumentContext = {
  title: string;
  authors: string;
  abstract: string;
  venue: string;
  year: string;
  pdfText: string;
  annotations: string[];
  notes: string[];
};

/**
 * Extract full context from a Zotero item including PDF text
 */
export async function extractDocumentContext(
  item: Zotero.Item,
): Promise<DocumentContext> {
  const mainItem =
    item.isAttachment() && item.parentID
      ? Zotero.Items.get(item.parentID)
      : item;

  const context: DocumentContext = {
    title: "",
    authors: "",
    abstract: "",
    venue: "",
    year: "",
    pdfText: "",
    annotations: [],
    notes: [],
  };

  if (!mainItem) return context;

  // Extract metadata
  context.title = (mainItem.getField("title") as string) || "";
  context.abstract = (mainItem.getField("abstractNote") as string) || "";
  context.venue = (mainItem.getField("publicationTitle") as string) || "";
  context.year = (mainItem.getField("year") as string) || "";

  // Extract authors
  const creators = (mainItem as any)?.getCreatorsJSON?.() as
    | { firstName?: string; lastName?: string }[]
    | undefined;
  if (creators && creators.length) {
    context.authors = creators
      .map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ").trim())
      .filter(Boolean)
      .join(", ");
  }

  // Extract PDF text
  const pdfAttachment = await findPDFAttachment(mainItem);
  if (pdfAttachment) {
    context.pdfText = await extractPDFText(pdfAttachment);
    context.annotations = await extractAnnotations(pdfAttachment);
  }

  // Extract notes
  context.notes = await extractNotes(mainItem);

  return context;
}

/**
 * Find PDF attachment for an item
 */
async function findPDFAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
    return item;
  }

  const attachmentIDs = item.getAttachments();
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (attachment?.attachmentContentType === "application/pdf") {
      return attachment;
    }
  }
  return null;
}

/**
 * Extract text content from PDF
 */
async function extractPDFText(pdfItem: Zotero.Item): Promise<string> {
  try {
    const path = await pdfItem.getFilePathAsync();
    if (!path) return "";

    // Use Zotero's built-in PDF text extraction
    const fullText = await Zotero.PDFWorker.getFullText(pdfItem.id);
    if (!fullText?.text) return "";

    let text = fullText.text;

    // Truncate if too long
    if (text.length > MAX_CONTENT_LENGTH) {
      text =
        text.substring(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]";
    }

    return text;
  } catch (error) {
    ztoolkit.log("Error extracting PDF text:", error);
    return "";
  }
}

/**
 * Extract annotations from PDF
 */
async function extractAnnotations(pdfItem: Zotero.Item): Promise<string[]> {
  const annotations: string[] = [];
  try {
    const annotationItems = pdfItem.getAnnotations();
    for (const annot of annotationItems) {
      const type = annot.annotationType;
      const text = annot.annotationText || "";
      const comment = annot.annotationComment || "";

      if (text || comment) {
        let annotStr = "";
        if (type === "highlight" && text) {
          annotStr = `[Highlight] "${text}"`;
          if (comment) annotStr += ` — Note: ${comment}`;
        } else if (type === "note" && comment) {
          annotStr = `[Note] ${comment}`;
        } else if (type === "underline" && text) {
          annotStr = `[Underline] "${text}"`;
          if (comment) annotStr += ` — Note: ${comment}`;
        } else if (comment) {
          annotStr = `[${type}] ${comment}`;
        }
        if (annotStr) annotations.push(annotStr);
      }
    }
  } catch (error) {
    ztoolkit.log("Error extracting annotations:", error);
  }
  return annotations;
}

/**
 * Extract notes attached to item
 */
async function extractNotes(item: Zotero.Item): Promise<string[]> {
  const notes: string[] = [];
  try {
    const noteIDs = item.getNotes();
    for (const id of noteIDs) {
      const note = Zotero.Items.get(id);
      if (note) {
        // Get note content and strip HTML
        const noteContent = note.getNote();
        const plainText = noteContent
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (plainText) {
          notes.push(plainText);
        }
      }
    }
  } catch (error) {
    ztoolkit.log("Error extracting notes:", error);
  }
  return notes;
}

/**
 * Build a formatted context string from document context
 */
export function buildContextString(context: DocumentContext): string {
  const parts: string[] = [];

  if (context.title) parts.push(`**Title:** ${context.title}`);
  if (context.authors) parts.push(`**Authors:** ${context.authors}`);
  if (context.year) parts.push(`**Year:** ${context.year}`);
  if (context.venue) parts.push(`**Venue:** ${context.venue}`);
  if (context.abstract) parts.push(`\n**Abstract:**\n${context.abstract}`);

  if (context.annotations.length > 0) {
    parts.push(`\n**User Annotations (${context.annotations.length}):**`);
    context.annotations.slice(0, 20).forEach((a) => parts.push(`- ${a}`));
    if (context.annotations.length > 20) {
      parts.push(`... and ${context.annotations.length - 20} more annotations`);
    }
  }

  if (context.notes.length > 0) {
    parts.push(`\n**User Notes (${context.notes.length}):**`);
    context.notes.forEach((n, i) => parts.push(`${i + 1}. ${n}`));
  }

  if (context.pdfText) {
    parts.push(`\n**Document Content:**\n${context.pdfText}`);
  }

  return parts.join("\n");
}

/**
 * Build a brief context string (metadata only, for display)
 */
export function buildBriefContext(context: DocumentContext): string {
  const parts: string[] = [];
  if (context.title) parts.push(`Title: ${context.title}`);
  if (context.authors) parts.push(`Authors: ${context.authors}`);
  if (context.year) parts.push(`Year: ${context.year}`);
  if (context.venue) parts.push(`Venue: ${context.venue}`);
  return parts.join("\n");
}
