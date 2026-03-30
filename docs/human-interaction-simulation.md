# Human Interaction Behavior: Expected vs Simulated Results

This simulation is based on the current code paths in:

- `src/agent/externalBackendBridge.ts`
- `src/agent/index.ts`
- `src/modules/contextPanel/agentMode/agentEngine.ts`

## Scenario A: Normal query with bridge enabled

User action:
- User asks a standard agent-mode question.

Expected runtime behavior:
- `agentBackendBridgeUrl` is non-empty, so `runTurn` is routed to external bridge.
- UI receives streamed `start` then `event` lines (status/message_delta/tool events), then `outcome`.

Simulated result:
- Assistant bubble streams text progressively.
- Tool trace rows appear as events arrive.
- Final assistant text equals `outcome.text` (or streamed text if already complete).

## Scenario B: Bridge URL empty

User action:
- User asks in agent mode, but bridge pref is empty.

Expected runtime behavior:
- Runtime bypasses external bridge and calls original local `AgentRuntime.runTurn`.

Simulated result:
- Behavior matches pre-integration baseline.
- No external HTTP dependency.

## Scenario C: Bridge unreachable / non-200

User action:
- User asks in agent mode while bridge process is down.

Expected runtime behavior:
- External fetch throws or returns non-200.
- Error propagates to existing `agentEngine` error path.

Simulated result:
- Request fails for that turn (current code does not silently auto-fallback to local runtime when bridge URL is set).
- User can recover by:
  - restarting bridge server, or
  - clearing bridge pref to return to local runtime.

## Scenario D: Bridge returns malformed stream

User action:
- User asks in agent mode; bridge sends malformed NDJSON.

Expected runtime behavior:
- Invalid lines are ignored by parser.
- If no `outcome` line is ever seen, runtime returns fallback outcome:
  - `kind: "fallback"`
  - reason: `"Bridge ended without outcome"`

Simulated result:
- UI receives partial events (if any), then fallback semantics.

## Scenario E: User cancels request mid-stream

User action:
- User clicks cancel during agent run.

Expected runtime behavior:
- Abort signal passed to fetch.
- Existing cancel logic in `agentEngine` handles cancellation state and marks assistant message as cancelled.

Simulated result:
- UI returns to idle controls.
- Assistant message finalized as cancelled behavior (existing app rules).

## Scenario F: Tool-heavy request with trace expectations

User action:
- User asks for a multi-step task requiring tools.

Expected runtime behavior:
- Bridge event lines include `tool_call` / `tool_result` / possibly `tool_error`.
- `agentEngine` appends these to `agentRunTraceCache` and refreshes trace UI.

Simulated result:
- Trace panel shows ordered tool lifecycle entries.
- Final response shown after `final` event/outcome.

## Practical operator guidance

- For reliability during migration, keep bridge pref togglable.
- Use local runtime path as immediate rollback switch.
- Keep bridge process logs visible during early dogfooding.

