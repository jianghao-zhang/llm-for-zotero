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
