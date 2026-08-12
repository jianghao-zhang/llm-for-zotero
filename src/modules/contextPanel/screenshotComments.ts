export type ScreenshotContextPayload = Readonly<{
  image: string;
  comment?: string;
}>;

export function normalizeScreenshotComments(
  images: readonly string[] | undefined,
  comments: readonly string[] | undefined,
): string[] {
  return (images || []).map((_, index) => `${comments?.[index] || ""}`.trim());
}

export function serializeScreenshotContexts(
  images: readonly string[] | undefined,
  comments: readonly string[] | undefined,
): string | null {
  const normalizedImages = (images || [])
    .map((image) => `${image || ""}`.trim())
    .filter(Boolean);
  if (!normalizedImages.length) return null;
  const normalizedComments = normalizeScreenshotComments(
    normalizedImages,
    comments,
  );
  const hasComment = normalizedComments.some(Boolean);
  return JSON.stringify(
    hasComment
      ? normalizedImages.map((image, index) => ({
          image,
          ...(normalizedComments[index]
            ? { comment: normalizedComments[index] }
            : {}),
        }))
      : normalizedImages,
  );
}

export function parseScreenshotContexts(value: unknown): {
  images: string[];
  comments: string[];
} {
  if (typeof value !== "string" || !value.trim()) {
    return { images: [], comments: [] };
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return { images: [], comments: [] };
    const payloads: ScreenshotContextPayload[] = parsed
      .map((entry): ScreenshotContextPayload | null => {
        if (typeof entry === "string" && entry.trim()) {
          return { image: entry.trim() };
        }
        if (!entry || typeof entry !== "object") return null;
        const image = `${(entry as { image?: unknown }).image || ""}`.trim();
        if (!image) return null;
        const comment =
          `${(entry as { comment?: unknown }).comment || ""}`.trim();
        return { image, ...(comment ? { comment } : {}) };
      })
      .filter((entry): entry is ScreenshotContextPayload => Boolean(entry));
    return {
      images: payloads.map((entry) => entry.image),
      comments: payloads.map((entry) => entry.comment || ""),
    };
  } catch {
    return { images: [], comments: [] };
  }
}

export function appendScreenshotCommentsToPrompt(
  prompt: string,
  comments: readonly string[] | undefined,
): string {
  const lines = (comments || [])
    .map((comment, index) => ({ comment: `${comment || ""}`.trim(), index }))
    .filter((entry) => Boolean(entry.comment))
    .map((entry) => `Screenshot ${entry.index + 1}: ${entry.comment}`);
  if (!lines.length) return prompt;
  const body = `Screenshot comments:\n${lines.join("\n")}`;
  const basePrompt = prompt.trimEnd();
  return basePrompt ? `${basePrompt}\n\n${body}` : body;
}
