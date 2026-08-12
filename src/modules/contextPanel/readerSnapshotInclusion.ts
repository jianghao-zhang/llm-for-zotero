export function appendReaderSnapshotImage(params: {
  existingImages: readonly string[];
  image: string;
  maxImages: number;
}): string[] {
  const image = `${params.image || ""}`.trim();
  if (!image || params.existingImages.length >= params.maxImages) {
    return [...params.existingImages];
  }
  return [...params.existingImages, image].slice(0, params.maxImages);
}

export function appendReaderSnapshotComment(params: {
  existingDraft: string;
  comment: string;
}): string {
  const comment = `${params.comment || ""}`.trim();
  if (!comment) return params.existingDraft;
  const note = `Screenshot note: ${comment}`;
  const existing = `${params.existingDraft || ""}`.trimEnd();
  return existing ? `${existing}\n\n${note}` : note;
}
