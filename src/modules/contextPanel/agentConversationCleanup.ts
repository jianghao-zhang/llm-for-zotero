import { clearAllAgentToolCaches } from "../../agent/tools";
import { clearAgentMemory } from "../../agent/store/conversationMemory";
import { clearAgentTranscript } from "../../agent/store/transcriptStore";
import { clearPersistedAgentEvidence } from "../../agent/context/cacheManagement";
import { clearPersistedAgentCoverage } from "../../agent/context/coverageLedger";
import { clearAgentResourceLifecycleState } from "../../agent/context/resourceLifecycle";

export type AgentConversationCleanupDeps = {
  clearAgentToolCaches?: (conversationKey: number) => void;
  clearAgentConversationState?: (conversationKey: number) => Promise<void>;
  log: (message: string, ...args: unknown[]) => void;
};

export async function clearAgentConversationState(
  conversationKey: number,
): Promise<void> {
  await Promise.all([
    clearAgentMemory(conversationKey),
    clearAgentTranscript(conversationKey),
    clearPersistedAgentEvidence(conversationKey),
    clearPersistedAgentCoverage(conversationKey),
  ]);
  clearAgentResourceLifecycleState(conversationKey);
}

export async function clearDeletedAgentConversationState(
  deps: AgentConversationCleanupDeps,
  conversationKey: number,
  kind: "global" | "paper",
): Promise<boolean> {
  let hasError = false;
  try {
    (deps.clearAgentToolCaches || clearAllAgentToolCaches)(conversationKey);
  } catch (err) {
    hasError = true;
    deps.log(`LLM: Failed to clear deleted ${kind} agent tool caches`, err);
  }
  try {
    await (deps.clearAgentConversationState || clearAgentConversationState)(
      conversationKey,
    );
  } catch (err) {
    hasError = true;
    deps.log(
      `LLM: Failed to clear deleted ${kind} agent conversation state`,
      err,
    );
  }
  return hasError;
}
