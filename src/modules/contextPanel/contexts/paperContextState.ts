/**
 * Paper context state management — pure state operations with no DOM dependencies.
 *
 * Manages:
 * - Send mode overrides (retrieval / full-next / full-sticky)
 * - Content source overrides (text / mineru / pdf)
 * - State clearing and lifecycle
 */

import type {
  PaperContextRef,
  PaperContextSendMode,
  PaperContentSourceMode,
} from "../types";
import {
  selectedPaperContextCache,
  selectedOtherRefContextCache,
  paperContextModeOverrides,
  paperContentSourceOverrides,
  selectedPaperPreviewExpandedCache,
} from "../state";
import { buildPaperKey } from "../pdfContext";
import { normalizePaperContextRefs } from "../normalizers";
import { sanitizeText } from "../textUtils";

// ── Send mode overrides ────────────────────────────────────────────────────

export function getPaperModeOverride(
  itemId: number,
  paperContext: PaperContextRef,
): PaperContextSendMode | null {
  return paperContextModeOverrides.get(itemId)?.get(buildPaperKey(paperContext)) || null;
}

export function setPaperModeOverride(
  itemId: number,
  paperContext: PaperContextRef,
  mode: PaperContextSendMode,
): void {
  let overrides = paperContextModeOverrides.get(itemId);
  if (!overrides) {
    overrides = new Map<string, PaperContextSendMode>();
    paperContextModeOverrides.set(itemId, overrides);
  }
  overrides.set(buildPaperKey(paperContext), mode);
}

export function clearPaperModeOverrides(itemId: number): void {
  paperContextModeOverrides.delete(itemId);
}

export function isPaperContextFullTextMode(
  mode: PaperContextSendMode | null | undefined,
): boolean {
  return mode === "full-next" || mode === "full-sticky";
}

// ── Content source overrides ────────────────────────────────────────────────

export function getPaperContentSourceOverride(
  itemId: number,
  paperContext: PaperContextRef,
): PaperContentSourceMode | null {
  return paperContentSourceOverrides.get(itemId)?.get(buildPaperKey(paperContext)) || null;
}

export function setPaperContentSourceOverride(
  itemId: number,
  paperContext: PaperContextRef,
  mode: PaperContentSourceMode,
): void {
  let overrides = paperContentSourceOverrides.get(itemId);
  if (!overrides) {
    overrides = new Map<string, PaperContentSourceMode>();
    paperContentSourceOverrides.set(itemId, overrides);
  }
  overrides.set(buildPaperKey(paperContext), mode);
}

export function clearPaperContentSourceOverrides(itemId: number): void {
  paperContentSourceOverrides.delete(itemId);
}

export function getNextContentSourceMode(
  current: PaperContentSourceMode,
  hasMinerU: boolean,
): PaperContentSourceMode {
  if (hasMinerU) {
    return current === "pdf" ? "mineru" : "pdf";
  }
  return current === "pdf" ? "text" : "pdf";
}

// ── State clearing ──────────────────────────────────────────────────────────

export function clearSelectedPaperState(itemId: number): void {
  selectedPaperContextCache.delete(itemId);
  selectedPaperPreviewExpandedCache.delete(itemId);
  clearPaperModeOverrides(itemId);
  // Note: content source overrides are NOT cleared here because auto-loaded
  // papers may still have overrides when selectedPaperContextCache is empty.
}

export function clearAllRefContextState(itemId: number): void {
  clearSelectedPaperState(itemId);
  selectedOtherRefContextCache.delete(itemId);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function normalizePaperContextEntries(value: unknown): PaperContextRef[] {
  return normalizePaperContextRefs(value, { sanitizeText });
}
