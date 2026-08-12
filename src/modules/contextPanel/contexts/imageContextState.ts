/**
 * Image/screenshot context state — pure state operations with no DOM dependencies.
 */

import {
  selectedImageCache,
  selectedImageCommentCache,
  selectedImagePreviewExpandedCache,
  selectedImagePreviewActiveIndexCache,
} from "../state";
import {
  clearPinnedContextOwner,
  retainPinnedImages,
} from "../setupHandlers/controllers/pinnedContextController";

export function clearSelectedImageState(
  pinnedImageKeys: Map<number, Set<string>>,
  itemId: number,
): void {
  selectedImageCache.delete(itemId);
  selectedImageCommentCache.delete(itemId);
  selectedImagePreviewExpandedCache.delete(itemId);
  selectedImagePreviewActiveIndexCache.delete(itemId);
  clearPinnedContextOwner(pinnedImageKeys, itemId);
}

export function retainPinnedImageState(
  pinnedImageKeys: Map<number, Set<string>>,
  itemId: number,
): void {
  const retained = retainPinnedImages(
    pinnedImageKeys,
    itemId,
    selectedImageCache.get(itemId) || [],
  );
  if (retained.length) {
    const previousImages = selectedImageCache.get(itemId) || [];
    const previousComments = selectedImageCommentCache.get(itemId) || [];
    selectedImageCache.set(itemId, retained);
    selectedImageCommentCache.set(
      itemId,
      retained.map((image) => {
        const previousIndex = previousImages.indexOf(image);
        return previousIndex >= 0 ? previousComments[previousIndex] || "" : "";
      }),
    );
    const currentActiveIndex = selectedImagePreviewActiveIndexCache.get(itemId);
    const normalizedActiveIndex =
      typeof currentActiveIndex === "number" &&
      Number.isFinite(currentActiveIndex)
        ? Math.max(
            0,
            Math.min(retained.length - 1, Math.floor(currentActiveIndex)),
          )
        : 0;
    selectedImagePreviewActiveIndexCache.set(itemId, normalizedActiveIndex);
    return;
  }
  selectedImageCache.delete(itemId);
  selectedImageCommentCache.delete(itemId);
  selectedImagePreviewExpandedCache.delete(itemId);
  selectedImagePreviewActiveIndexCache.delete(itemId);
}
