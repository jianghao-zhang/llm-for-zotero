# External Bridge Quickstart (Copy-Paste)

This is the shortest path to run `llm-for-zotero` agent mode with the external Claude Code backend bridge.

## 0) Repos/branches assumed

- `cc-llm4zotero-adapter`: `main`
- `llm-for-zotero`: `feature/external-agent-bridge`

## 1) Start adapter bridge server

```bash
cd "/Users/jianghao_zhang/Library/CloudStorage/GoogleDrive-araraichemist@gmail.com/My Drive/projs/cc-llm4zotero-adapter"
npm install
npm run serve:bridge
```

If `8787` is occupied, use:

```bash
npx tsx bin/start-bridge-server.ts --host 127.0.0.1 --port 18787
```

Health check (new terminal):

```bash
curl -sS http://127.0.0.1:8787/healthz
# or: curl -sS http://127.0.0.1:18787/healthz
```

Expected:

```json
{"ok":true,"ts":...}
```

## 2) Set llm-for-zotero pref to route agent runtime

Pref key:

```text
extensions.zotero.llmforzotero.agentBackendBridgeUrl
```

Value examples:

```text
http://127.0.0.1:8787
http://127.0.0.1:18787
```

Set from Zotero JS console:

```js
Zotero.Prefs.set("extensions.zotero.llmforzotero.agentBackendBridgeUrl", "http://127.0.0.1:8787", true)
```

Disable external bridge (revert to local runtime):

```js
Zotero.Prefs.set("extensions.zotero.llmforzotero.agentBackendBridgeUrl", "", true)
```

## 3) Run llm-for-zotero checks on integration branch

```bash
cd "/Users/jianghao_zhang/Library/CloudStorage/GoogleDrive-araraichemist@gmail.com/My Drive/projs/llm-for-zotero"
git switch feature/external-agent-bridge
npm run typecheck
npx tsx node_modules/mocha/bin/mocha.js test/externalBackendBridge.test.ts
```

Expected:

- typecheck passes
- `external backend bridge runtime` tests: `2 passing`

## 4) Minimal manual E2E smoke

1. Open Zotero panel in agent mode.
2. Ask a simple task (for example: "Summarize the selected paper title and metadata").
3. Verify assistant still streams events and final response appears.
4. Kill bridge server; run same query again: should fail fast or fallback per current behavior.
5. Clear pref (empty string), retry query: local runtime path should work again.

## Self-check status in this workspace

Validated in this environment:

- adapter server launched successfully on `127.0.0.1:18787`
- `/healthz` returned `{"ok":true,...}`
- `/run-turn` invalid payload returned `400` with validation error JSON
- llm-for-zotero bridge integration files compile and tests pass

