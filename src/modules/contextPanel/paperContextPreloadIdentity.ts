export function chooseCurrentPaperBaseItemForMode<T>(params: {
  isGlobalMode: boolean;
  liveRawBaseItem: T | null;
  activeReaderBaseItem: T | null;
  cachedBasePaperItem: T | null;
  currentItemBaseItem: T | null;
}): T | null {
  if (params.isGlobalMode) {
    return (
      params.liveRawBaseItem ||
      params.activeReaderBaseItem ||
      params.cachedBasePaperItem ||
      params.currentItemBaseItem ||
      null
    );
  }
  return (
    params.cachedBasePaperItem ||
    params.currentItemBaseItem ||
    params.activeReaderBaseItem ||
    params.liveRawBaseItem ||
    null
  );
}

export function chooseAutoLoadedContextPanelItem<T>(params: {
  isGlobalMode: boolean;
  currentItem: T | null;
  currentPaperBaseItem: T | null;
  liveRawPanelItem: T | null;
}): T | null {
  if (!params.currentItem) return null;
  if (params.isGlobalMode) {
    return params.liveRawPanelItem || params.currentItem;
  }
  return (
    params.currentPaperBaseItem || params.liveRawPanelItem || params.currentItem
  );
}

export function isAutoLoadedSnapshotForCurrentPaper(params: {
  currentOwnerItemId: number | null;
  snapshotOwnerItemId: number | null;
}): boolean {
  return Boolean(
    params.currentOwnerItemId &&
    params.snapshotOwnerItemId &&
    params.currentOwnerItemId === params.snapshotOwnerItemId,
  );
}
