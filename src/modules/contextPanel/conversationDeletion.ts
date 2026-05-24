import type { ConversationSystem } from "../../shared/types";
import {
  activeGlobalConversationByLibrary,
  activePaperConversationByPaper,
  chatHistory,
  getAbortController,
  getPendingRequestId,
  loadedConversationKeys,
  selectedModelCache,
  selectedReasoningCache,
  selectedReasoningProviderCache,
  setAbortController,
  setCancelledRequestId,
  setPendingRequestId,
} from "./state";
import { clearConversationSummary as clearConversationSummaryFromCache } from "./conversationSummaryCache";
import {
  clearConversation as clearStoredConversation,
  deleteGlobalConversation,
  deletePaperConversation,
} from "../../utils/chatStore";
import {
  buildPaperStateKey,
  getLastUsedPaperConversationKey,
  getLockedGlobalConversationKey,
  removeLastUsedPaperConversationKey,
  setLockedGlobalConversationKey,
} from "./prefHelpers";
import { clearOwnerAttachmentRefs } from "../../utils/attachmentRefStore";
import { removeConversationAttachmentFiles } from "./attachmentStorage";
import {
  clearClaudeConversation,
  deleteClaudeConversation,
} from "../../claudeCode/store";
import {
  buildClaudeScope,
  invalidateClaudeConversationSession,
} from "../../claudeCode/runtime";
import {
  activeClaudeGlobalConversationByLibrary,
  activeClaudePaperConversationByPaper,
  buildClaudeLibraryStateKey,
  buildClaudePaperStateKey,
} from "../../claudeCode/state";
import {
  getLastUsedClaudeGlobalConversationKey,
  getLastUsedClaudePaperConversationKey,
  removeLastUsedClaudeGlobalConversationKey,
  removeLastUsedClaudePaperConversationKey,
} from "../../claudeCode/prefs";
import {
  clearCodexConversation,
  deleteCodexConversation,
} from "../../codexAppServer/store";
import { archiveCodexAppServerThread } from "../../codexAppServer/nativeClient";
import {
  activeCodexGlobalConversationByLibrary,
  activeCodexPaperConversationByPaper,
  buildCodexLibraryStateKey,
  buildCodexPaperStateKey,
} from "../../codexAppServer/state";
import {
  getLastUsedCodexGlobalConversationKey,
  getLastUsedCodexPaperConversationKey,
  removeLastUsedCodexGlobalConversationKey,
  removeLastUsedCodexPaperConversationKey,
} from "../../codexAppServer/prefs";
import {
  clearAgentConversationState,
  clearDeletedAgentConversationState,
} from "./agentConversationCleanup";

type ConversationDeletionKind = "global" | "paper";

export type ConversationDeletionTarget = {
  conversationKey: number;
  kind: ConversationDeletionKind;
  conversationSystem: ConversationSystem;
  libraryID: number;
  paperItemID?: number;
  providerSessionId?: string | null;
};

export type ConversationDeletionIssueCode =
  | "cancel_pending_request"
  | "runtime_cache"
  | "agent_state"
  | "claude_session"
  | "codex_thread_archive"
  | "message_rows"
  | "attachment_refs"
  | "attachment_files"
  | "catalog_row"
  | "remembered_selection"
  | "attachment_gc";

export type ConversationDeletionIssue = {
  code: ConversationDeletionIssueCode;
  message: string;
  error?: unknown;
};

export type ConversationDeletionResult = {
  ok: boolean;
  blocked: boolean;
  errors: ConversationDeletionIssue[];
  warnings: ConversationDeletionIssue[];
};

type ConversationDeletionOperations = {
  clearStoredConversation: typeof clearStoredConversation;
  deleteGlobalConversation: typeof deleteGlobalConversation;
  deletePaperConversation: typeof deletePaperConversation;
  clearClaudeConversation: typeof clearClaudeConversation;
  deleteClaudeConversation: typeof deleteClaudeConversation;
  clearCodexConversation: typeof clearCodexConversation;
  deleteCodexConversation: typeof deleteCodexConversation;
  clearOwnerAttachmentRefs: typeof clearOwnerAttachmentRefs;
  removeConversationAttachmentFiles: typeof removeConversationAttachmentFiles;
  archiveCodexThread: (threadId: string) => Promise<void>;
  invalidateClaudeConversation: (
    conversationKey: number,
    target: ConversationDeletionTarget,
  ) => Promise<void>;
  clearRememberedSelection: (target: ConversationDeletionTarget) => void;
};

export type ConversationDeletionDeps = {
  log?: (message: string, ...args: unknown[]) => void;
  cancelPendingRequest?: (conversationKey: number) => void;
  clearTransientComposeStateForItem?: (itemId: number) => void;
  resetSessionTokens?: (conversationKey: number) => void;
  scheduleAttachmentGc?: () => void;
  getCoreAgentRuntime?: () => unknown;
  clearAgentToolCaches?: (conversationKey: number) => void;
  clearAgentConversationState?: (conversationKey: number) => Promise<void>;
  operations?: Partial<ConversationDeletionOperations>;
};

function normalizePositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function normalizeProviderSessionId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createResult(): ConversationDeletionResult {
  return {
    ok: true,
    blocked: false,
    errors: [],
    warnings: [],
  };
}

function defaultCancelPendingRequest(conversationKey: number): void {
  const pendingRequestId = getPendingRequestId(conversationKey);
  if (pendingRequestId <= 0) return;
  const ctrl = getAbortController(conversationKey);
  if (ctrl) ctrl.abort();
  setCancelledRequestId(conversationKey, pendingRequestId);
  setPendingRequestId(conversationKey, 0);
  setAbortController(conversationKey, null);
}

function clearSharedRuntimeCaches(
  conversationKey: number,
  deps: ConversationDeletionDeps,
): void {
  chatHistory.delete(conversationKey);
  loadedConversationKeys.delete(conversationKey);
  selectedModelCache.delete(conversationKey);
  selectedReasoningCache.delete(conversationKey);
  selectedReasoningProviderCache.delete(conversationKey);
  deps.resetSessionTokens?.(conversationKey);
  deps.clearTransientComposeStateForItem?.(conversationKey);
  clearConversationSummaryFromCache(conversationKey);
}

function buildOperations(
  deps: ConversationDeletionDeps,
): ConversationDeletionOperations {
  return {
    clearStoredConversation,
    deleteGlobalConversation,
    deletePaperConversation,
    clearClaudeConversation,
    deleteClaudeConversation,
    clearCodexConversation,
    deleteCodexConversation,
    clearOwnerAttachmentRefs,
    removeConversationAttachmentFiles,
    archiveCodexThread: (threadId) =>
      archiveCodexAppServerThread({ threadId }),
    invalidateClaudeConversation: async (conversationKey, target) => {
      if (!deps.getCoreAgentRuntime) {
        return;
      }
      await invalidateClaudeConversationSession(deps.getCoreAgentRuntime() as any, {
        conversationKey,
        scope: buildClaudeScope({
          libraryID: target.libraryID,
          kind: target.kind,
          paperItemID: target.paperItemID,
        }),
      });
    },
    clearRememberedSelection,
    ...deps.operations,
  };
}

function recordIssue(
  result: ConversationDeletionResult,
  list: "errors" | "warnings",
  issue: ConversationDeletionIssue,
  log?: (message: string, ...args: unknown[]) => void,
): void {
  result[list].push(issue);
  if (list === "errors") result.ok = false;
  log?.(issue.message, issue.error);
}

async function runStep(
  result: ConversationDeletionResult,
  code: ConversationDeletionIssueCode,
  message: string,
  fn: () => void | Promise<void>,
  log?: (message: string, ...args: unknown[]) => void,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    recordIssue(result, "errors", { code, message, error }, log);
  }
}

async function clearMessageRows(
  operations: ConversationDeletionOperations,
  target: ConversationDeletionTarget,
): Promise<void> {
  if (target.conversationSystem === "claude_code") {
    await operations.clearClaudeConversation(target.conversationKey);
  } else if (target.conversationSystem === "codex") {
    await operations.clearCodexConversation(target.conversationKey);
  } else {
    await operations.clearStoredConversation(target.conversationKey);
  }
}

async function deleteCatalogRow(
  operations: ConversationDeletionOperations,
  target: ConversationDeletionTarget,
): Promise<void> {
  if (target.conversationSystem === "claude_code") {
    await operations.deleteClaudeConversation(target.conversationKey);
  } else if (target.conversationSystem === "codex") {
    await operations.deleteCodexConversation(target.conversationKey);
  } else if (target.kind === "global") {
    await operations.deleteGlobalConversation(target.conversationKey);
  } else {
    await operations.deletePaperConversation(target.conversationKey);
  }
}

function clearRememberedSelection(target: ConversationDeletionTarget): void {
  const conversationKey = target.conversationKey;
  if (target.kind === "global") {
    if (target.conversationSystem === "claude_code") {
      const stateKey = buildClaudeLibraryStateKey(target.libraryID);
      if (
        Math.floor(Number(activeClaudeGlobalConversationByLibrary.get(stateKey) || 0)) ===
        conversationKey
      ) {
        activeClaudeGlobalConversationByLibrary.delete(stateKey);
      }
      const persistedKey = Number(
        getLastUsedClaudeGlobalConversationKey(target.libraryID) || 0,
      );
      if (Number.isFinite(persistedKey) && Math.floor(persistedKey) === conversationKey) {
        removeLastUsedClaudeGlobalConversationKey(target.libraryID);
      }
      return;
    }
    if (target.conversationSystem === "codex") {
      const stateKey = buildCodexLibraryStateKey(target.libraryID);
      if (
        Math.floor(Number(activeCodexGlobalConversationByLibrary.get(stateKey) || 0)) ===
        conversationKey
      ) {
        activeCodexGlobalConversationByLibrary.delete(stateKey);
      }
      const persistedKey = Number(
        getLastUsedCodexGlobalConversationKey(target.libraryID) || 0,
      );
      if (Number.isFinite(persistedKey) && Math.floor(persistedKey) === conversationKey) {
        removeLastUsedCodexGlobalConversationKey(target.libraryID);
      }
      return;
    }
    if (
      Math.floor(Number(activeGlobalConversationByLibrary.get(target.libraryID) || 0)) ===
      conversationKey
    ) {
      activeGlobalConversationByLibrary.delete(target.libraryID);
    }
    const lockedKey = getLockedGlobalConversationKey(target.libraryID);
    if (
      lockedKey !== null &&
      Number.isFinite(lockedKey) &&
      Math.floor(Number(lockedKey)) === conversationKey
    ) {
      setLockedGlobalConversationKey(target.libraryID, null);
    }
    return;
  }

  const paperItemID = normalizePositiveInt(target.paperItemID);
  if (!paperItemID) return;
  if (target.conversationSystem === "claude_code") {
    const stateKey = buildClaudePaperStateKey(target.libraryID, paperItemID);
    if (
      Math.floor(Number(activeClaudePaperConversationByPaper.get(stateKey) || 0)) ===
      conversationKey
    ) {
      activeClaudePaperConversationByPaper.delete(stateKey);
    }
    const persistedKey = Number(
      getLastUsedClaudePaperConversationKey(target.libraryID, paperItemID) || 0,
    );
    if (Number.isFinite(persistedKey) && Math.floor(persistedKey) === conversationKey) {
      removeLastUsedClaudePaperConversationKey(target.libraryID, paperItemID);
    }
    return;
  }
  if (target.conversationSystem === "codex") {
    const stateKey = buildCodexPaperStateKey(target.libraryID, paperItemID);
    if (
      Math.floor(Number(activeCodexPaperConversationByPaper.get(stateKey) || 0)) ===
      conversationKey
    ) {
      activeCodexPaperConversationByPaper.delete(stateKey);
    }
    const persistedKey = Number(
      getLastUsedCodexPaperConversationKey(target.libraryID, paperItemID) || 0,
    );
    if (Number.isFinite(persistedKey) && Math.floor(persistedKey) === conversationKey) {
      removeLastUsedCodexPaperConversationKey(target.libraryID, paperItemID);
    }
    return;
  }
  const stateKey = buildPaperStateKey(target.libraryID, paperItemID);
  if (
    Math.floor(Number(activePaperConversationByPaper.get(stateKey) || 0)) ===
    conversationKey
  ) {
    activePaperConversationByPaper.delete(stateKey);
  }
  const persistedKey = Number(
    getLastUsedPaperConversationKey(target.libraryID, paperItemID) || 0,
  );
  if (Number.isFinite(persistedKey) && Math.floor(persistedKey) === conversationKey) {
    removeLastUsedPaperConversationKey(target.libraryID, paperItemID);
  }
}

export async function finalizeConversationDeletion(
  target: ConversationDeletionTarget,
  deps: ConversationDeletionDeps = {},
): Promise<ConversationDeletionResult> {
  const result = createResult();
  const conversationKey = normalizePositiveInt(target.conversationKey);
  const libraryID = normalizePositiveInt(target.libraryID);
  const log = deps.log;
  if (!conversationKey || !libraryID) {
    recordIssue(
      result,
      "errors",
      {
        code: "catalog_row",
        message: "LLM: Cannot delete conversation with invalid identity",
      },
      log,
    );
    return result;
  }

  const normalizedTarget: ConversationDeletionTarget = {
    ...target,
    conversationKey,
    libraryID,
    paperItemID: normalizePositiveInt(target.paperItemID) || undefined,
  };
  const operations = buildOperations(deps);

  await runStep(
    result,
    "cancel_pending_request",
    "LLM: Failed to cancel pending request for deleted conversation",
    () => (deps.cancelPendingRequest || defaultCancelPendingRequest)(conversationKey),
    log,
  );
  await runStep(
    result,
    "runtime_cache",
    "LLM: Failed to clear deleted conversation runtime caches",
    () => clearSharedRuntimeCaches(conversationKey, deps),
    log,
  );

  const agentHadError = await clearDeletedAgentConversationState(
    {
      clearAgentToolCaches: deps.clearAgentToolCaches,
      clearAgentConversationState:
        deps.clearAgentConversationState || clearAgentConversationState,
      log: log || (() => {}),
    },
    conversationKey,
    normalizedTarget.kind,
  );
  if (agentHadError) {
    recordIssue(result, "errors", {
      code: "agent_state",
      message: "LLM: Failed to fully clear deleted agent conversation state",
    });
  }

  if (normalizedTarget.conversationSystem === "claude_code") {
    await runStep(
      result,
      "claude_session",
      "LLM: Failed to invalidate deleted Claude conversation",
      () => operations.invalidateClaudeConversation(conversationKey, normalizedTarget),
      log,
    );
  }

  const codexThreadId =
    normalizedTarget.conversationSystem === "codex"
      ? normalizeProviderSessionId(normalizedTarget.providerSessionId)
      : "";
  if (codexThreadId) {
    try {
      await operations.archiveCodexThread(codexThreadId);
    } catch (error) {
      result.blocked = true;
      recordIssue(
        result,
        "errors",
        {
          code: "codex_thread_archive",
          message:
            "LLM: Failed to archive Codex thread; local conversation was not deleted",
          error,
        },
        log,
      );
      return result;
    }
  }

  await runStep(
    result,
    "message_rows",
    "LLM: Failed to clear deleted conversation messages",
    () => clearMessageRows(operations, normalizedTarget),
    log,
  );
  await runStep(
    result,
    "catalog_row",
    "LLM: Failed to delete conversation catalog row",
    () => deleteCatalogRow(operations, normalizedTarget),
    log,
  );
  await runStep(
    result,
    "attachment_refs",
    "LLM: Failed to clear deleted conversation attachment refs",
    () => operations.clearOwnerAttachmentRefs("conversation", conversationKey),
    log,
  );
  await runStep(
    result,
    "attachment_files",
    "LLM: Failed to remove deleted conversation attachment files",
    () => operations.removeConversationAttachmentFiles(conversationKey),
    log,
  );
  await runStep(
    result,
    "remembered_selection",
    "LLM: Failed to clear deleted conversation selection state",
    () => operations.clearRememberedSelection(normalizedTarget),
    log,
  );
  await runStep(
    result,
    "attachment_gc",
    "LLM: Failed to schedule deleted conversation attachment GC",
    () => deps.scheduleAttachmentGc?.(),
    log,
  );

  return result;
}
