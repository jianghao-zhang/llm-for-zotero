import type { StoredChatMessage } from "../utils/chatStore";

export type CodexNativeThreadSnapshotTurn = Readonly<{
  id: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  userText?: string;
  assistantText?: string;
}>;

export type CodexNativeThreadSnapshot = Readonly<{
  threadId: string;
  name?: string;
  turns: readonly CodexNativeThreadSnapshotTurn[];
}>;

export type CodexExternalTurnImport = Readonly<{
  turnId: string;
  messages: readonly StoredChatMessage[];
}>;

export type CodexExternalThreadSyncResolution = Readonly<{
  imports: readonly CodexExternalTurnImport[];
  markTurnIds: readonly string[];
}>;

function normalizeText(value: string | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function timestampMs(seconds: number | undefined, fallback: number): number {
  return Number.isFinite(seconds) && Number(seconds) > 0
    ? Math.floor(Number(seconds) * 1000)
    : fallback;
}

function buildLocalPairs(
  messages: readonly Pick<StoredChatMessage, "role" | "text" | "timestamp">[],
): Array<{ user: string; assistant: string; timestamp: number }> {
  const pairs: Array<{ user: string; assistant: string; timestamp: number }> = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role !== "user" || assistant.role !== "assistant") continue;
    pairs.push({
      user: normalizeText(user.text),
      assistant: normalizeText(assistant.text),
      timestamp: Math.min(user.timestamp, assistant.timestamp),
    });
    index += 1;
  }
  return pairs;
}

function turnMatchesLocalPair(
  turn: CodexNativeThreadSnapshotTurn,
  pair: { user: string; assistant: string },
): boolean {
  const user = normalizeText(turn.userText);
  const assistant = normalizeText(turn.assistantText);
  if (!assistant || assistant !== pair.assistant) return false;
  if (!pair.user) return true;
  return (
    user === pair.user ||
    user.endsWith(pair.user) ||
    user.includes(`User question: ${pair.user}`)
  );
}

function buildExternalMessages(
  turn: CodexNativeThreadSnapshotTurn,
  fallbackTimestamp: number,
): StoredChatMessage[] {
  const messages: StoredChatMessage[] = [];
  const userTimestamp = timestampMs(turn.startedAt, fallbackTimestamp);
  if (turn.userText) {
    messages.push({
      role: "user",
      text: turn.userText,
      timestamp: userTimestamp,
      runMode: "agent",
    });
  }
  if (turn.assistantText) {
    messages.push({
      role: "assistant",
      text: turn.assistantText,
      timestamp: Math.max(
        userTimestamp + 1,
        timestampMs(turn.completedAt, userTimestamp + 1),
      ),
      runMode: "agent",
    });
  }
  return messages;
}

export function resolveCodexExternalThreadSync(params: {
  snapshot: CodexNativeThreadSnapshot;
  syncedTurnIds: ReadonlySet<string>;
  localMessages: readonly Pick<
    StoredChatMessage,
    "role" | "text" | "timestamp"
  >[];
  ignoredTurnId?: string;
  now?: number;
}): CodexExternalThreadSyncResolution {
  const completedTurns = params.snapshot.turns.filter(
    (turn) => turn.status === "completed",
  );
  const localPairs = buildLocalPairs(params.localMessages);
  const earliestLocalTimestamp = localPairs.length
    ? Math.min(...localPairs.map((pair) => pair.timestamp))
    : 0;
  let localPairIndex = 0;
  const imports: CodexExternalTurnImport[] = [];
  const markTurnIds: string[] = [];
  const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();

  for (const [turnIndex, turn] of completedTurns.entries()) {
    if (params.syncedTurnIds.has(turn.id)) continue;
    if (turn.id === params.ignoredTurnId) continue;
    let matchingPairIndex = -1;
    for (let index = localPairIndex; index < localPairs.length; index += 1) {
      if (turnMatchesLocalPair(turn, localPairs[index])) {
        matchingPairIndex = index;
        break;
      }
    }
    if (matchingPairIndex >= 0) {
      localPairIndex = matchingPairIndex + 1;
      markTurnIds.push(turn.id);
      continue;
    }
    const completedAtMs = timestampMs(turn.completedAt, 0);
    if (
      earliestLocalTimestamp > 0 &&
      completedAtMs > 0 &&
      completedAtMs < earliestLocalTimestamp
    ) {
      markTurnIds.push(turn.id);
      continue;
    }
    imports.push({
      turnId: turn.id,
      messages: buildExternalMessages(turn, now - 1000 + turnIndex * 2),
    });
    markTurnIds.push(turn.id);
  }
  return { imports, markTurnIds };
}
