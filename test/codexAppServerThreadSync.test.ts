import { assert } from "chai";
import { resolveCodexExternalThreadSync } from "../src/codexAppServer/threadSync";

describe("Codex shared thread sync", function () {
  const snapshot = {
    threadId: "thread-shared",
    name: "Shared paper chat",
    turns: [
      {
        id: "turn-zotero",
        status: "completed",
        startedAt: 100,
        completedAt: 101,
        userText: "Original Zotero question",
        assistantText: "Original Zotero answer",
      },
      {
        id: "turn-app",
        status: "completed",
        startedAt: 102,
        completedAt: 103,
        userText: "Continued in Codex App",
        assistantText: "Answer from Codex App",
      },
    ],
  } as const;
  const localMessages = [
    {
      role: "user" as const,
      text: "Original Zotero question",
      timestamp: 100_000,
    },
    {
      role: "assistant" as const,
      text: "Original Zotero answer",
      timestamp: 101_000,
    },
  ];

  it("matches existing local history and imports unknown external turns", function () {
    const resolved = resolveCodexExternalThreadSync({
      snapshot,
      syncedTurnIds: new Set(),
      localMessages,
    });
    assert.deepEqual(resolved.markTurnIds, ["turn-zotero", "turn-app"]);
    assert.deepEqual(resolved.imports, [
      {
        turnId: "turn-app",
        messages: [
          {
            role: "user",
            text: "Continued in Codex App",
            timestamp: 102_000,
            runMode: "agent",
          },
          {
            role: "assistant",
            text: "Answer from Codex App",
            timestamp: 103_000,
            runMode: "agent",
          },
        ],
      },
    ]);
  });

  it("imports all completed turns when no local history exists", function () {
    const resolved = resolveCodexExternalThreadSync({
      snapshot,
      syncedTurnIds: new Set(),
      localMessages: [],
    });
    assert.deepEqual(
      resolved.imports.map((entry) => entry.turnId),
      ["turn-zotero", "turn-app"],
    );
  });

  it("ignores the just-completed Zotero turn until local persistence finishes", function () {
    const resolved = resolveCodexExternalThreadSync({
      snapshot,
      syncedTurnIds: new Set(["turn-zotero"]),
      localMessages,
      ignoredTurnId: "turn-app",
    });
    assert.deepEqual(resolved, {
      imports: [],
      markTurnIds: [],
    });
  });

  it("does not advance across an in-progress external turn", function () {
    const resolved = resolveCodexExternalThreadSync({
      snapshot: {
        ...snapshot,
        turns: [
          ...snapshot.turns,
          {
            id: "turn-pending",
            status: "inProgress",
            startedAt: 104,
            userText: "Still running",
          },
        ],
      },
      syncedTurnIds: new Set(["turn-zotero", "turn-app"]),
      localMessages,
    });
    assert.deepEqual(resolved, { imports: [], markTurnIds: [] });
  });
});
