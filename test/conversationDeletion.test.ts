import { assert } from "chai";
import { finalizeConversationDeletion } from "../src/modules/contextPanel/conversationDeletion";

describe("conversationDeletion", function () {
  function createOperations(calls: string[]) {
    return {
      clearStoredConversation: async (conversationKey: number) => {
        calls.push(`clear-upstream:${conversationKey}`);
      },
      deleteGlobalConversation: async (conversationKey: number) => {
        calls.push(`delete-global:${conversationKey}`);
      },
      deletePaperConversation: async (conversationKey: number) => {
        calls.push(`delete-paper:${conversationKey}`);
      },
      clearClaudeConversation: async (conversationKey: number) => {
        calls.push(`clear-claude:${conversationKey}`);
      },
      deleteClaudeConversation: async (conversationKey: number) => {
        calls.push(`delete-claude:${conversationKey}`);
      },
      clearCodexConversation: async (conversationKey: number) => {
        calls.push(`clear-codex:${conversationKey}`);
      },
      deleteCodexConversation: async (conversationKey: number) => {
        calls.push(`delete-codex:${conversationKey}`);
      },
      clearOwnerAttachmentRefs: async (_ownerType: string, ownerKey: number) => {
        calls.push(`refs:${ownerKey}`);
      },
      removeConversationAttachmentFiles: async (conversationKey: number) => {
        calls.push(`files:${conversationKey}`);
      },
      archiveCodexThread: async (threadId: string) => {
        calls.push(`archive:${threadId}`);
      },
      invalidateClaudeConversation: async (conversationKey: number) => {
        calls.push(`invalidate-claude:${conversationKey}`);
      },
      clearRememberedSelection: () => {
        calls.push("selection");
      },
    };
  }

  it("deletes upstream global conversations through the shared cleanup path", async function () {
    const calls: string[] = [];
    const result = await finalizeConversationDeletion(
      {
        conversationKey: 7101,
        kind: "global",
        conversationSystem: "upstream",
        libraryID: 1,
      },
      {
        cancelPendingRequest: (conversationKey) => {
          calls.push(`cancel:${conversationKey}`);
        },
        clearTransientComposeStateForItem: (itemId) => {
          calls.push(`compose:${itemId}`);
        },
        resetSessionTokens: (conversationKey) => {
          calls.push(`tokens:${conversationKey}`);
        },
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        scheduleAttachmentGc: () => {
          calls.push("gc");
        },
        operations: createOperations(calls),
      },
    );

    assert.isTrue(result.ok);
    assert.deepEqual(calls, [
      "cancel:7101",
      "tokens:7101",
      "compose:7101",
      "tool:7101",
      "agent:7101",
      "clear-upstream:7101",
      "delete-global:7101",
      "refs:7101",
      "files:7101",
      "selection",
      "gc",
    ]);
  });

  it("deletes upstream paper conversations with the paper catalog path", async function () {
    const calls: string[] = [];
    const result = await finalizeConversationDeletion(
      {
        conversationKey: 7102,
        kind: "paper",
        conversationSystem: "upstream",
        libraryID: 1,
        paperItemID: 44,
      },
      {
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        operations: createOperations(calls),
      },
    );

    assert.isTrue(result.ok);
    assert.includeMembers(calls, [
      "clear-upstream:7102",
      "delete-paper:7102",
    ]);
  });

  it("archives a Codex thread before deleting local Codex rows", async function () {
    const calls: string[] = [];
    const result = await finalizeConversationDeletion(
      {
        conversationKey: 8101,
        kind: "global",
        conversationSystem: "codex",
        libraryID: 2,
        providerSessionId: "thread-abc",
      },
      {
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        operations: createOperations(calls),
      },
    );

    assert.isTrue(result.ok);
    assert.deepEqual(calls.slice(0, 5), [
      "tool:8101",
      "agent:8101",
      "archive:thread-abc",
      "clear-codex:8101",
      "delete-codex:8101",
    ]);
  });

  it("blocks local Codex deletion if native thread archival fails", async function () {
    const calls: string[] = [];
    const operations = createOperations(calls);
    operations.archiveCodexThread = async (threadId: string) => {
      calls.push(`archive:${threadId}`);
      throw new Error("archive failed");
    };

    const result = await finalizeConversationDeletion(
      {
        conversationKey: 8102,
        kind: "paper",
        conversationSystem: "codex",
        libraryID: 2,
        paperItemID: 55,
        providerSessionId: "thread-blocked",
      },
      {
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        scheduleAttachmentGc: () => {
          calls.push("gc");
        },
        operations,
      },
    );

    assert.isFalse(result.ok);
    assert.isTrue(result.blocked);
    assert.deepEqual(calls, [
      "tool:8102",
      "agent:8102",
      "archive:thread-blocked",
    ]);
  });

  it("allows local Codex deletion when there is no stored native thread id", async function () {
    const calls: string[] = [];
    const result = await finalizeConversationDeletion(
      {
        conversationKey: 8103,
        kind: "global",
        conversationSystem: "codex",
        libraryID: 2,
      },
      {
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        operations: createOperations(calls),
      },
    );

    assert.isTrue(result.ok);
    assert.notInclude(calls.join(","), "archive:");
    assert.includeMembers(calls, ["clear-codex:8103", "delete-codex:8103"]);
  });

  it("invalidates Claude before deleting local Claude rows", async function () {
    const calls: string[] = [];
    const result = await finalizeConversationDeletion(
      {
        conversationKey: 9101,
        kind: "paper",
        conversationSystem: "claude_code",
        libraryID: 3,
        paperItemID: 66,
      },
      {
        clearAgentToolCaches: (conversationKey) => {
          calls.push(`tool:${conversationKey}`);
        },
        clearAgentConversationState: async (conversationKey) => {
          calls.push(`agent:${conversationKey}`);
        },
        operations: createOperations(calls),
      },
    );

    assert.isTrue(result.ok);
    assert.deepEqual(calls.slice(0, 5), [
      "tool:9101",
      "agent:9101",
      "invalidate-claude:9101",
      "clear-claude:9101",
      "delete-claude:9101",
    ]);
  });
});
