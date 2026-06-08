import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "chai";

const here = dirname(fileURLToPath(import.meta.url));

describe("webchat isolation", function () {
  it("does not let the webchat mode chip switch paper/library modes", function () {
    const source = readFileSync(
      resolve(
        here,
        "../src/modules/contextPanel/setupHandlers/controllers/historyLifecycleController.ts",
      ),
      "utf8",
    );
    const handlerStart = source.indexOf("// --- Mode chip handler ---");
    const webchatGuard = source.indexOf(
      "if (!item || isNoteSession() || isWebChatMode()) return;",
      handlerStart,
    );
    const paperSwitch = source.indexOf(
      "void switchPaperConversation();",
      handlerStart,
    );
    const globalSwitch = source.indexOf(
      "void switchGlobalConversation",
      handlerStart,
    );

    assert.isAtLeast(handlerStart, 0);
    assert.isAtLeast(webchatGuard, handlerStart);
    assert.isBelow(webchatGuard, paperSwitch);
    assert.isBelow(webchatGuard, globalSwitch);
  });

  it("marks webchat paper switches loaded before stored history can rehydrate", function () {
    const source = readFileSync(
      resolve(
        here,
        "../src/modules/contextPanel/setupHandlers/controllers/historyLifecycleController.ts",
      ),
      "utf8",
    );
    const switchStart = source.indexOf("const switchPaperConversation = async");
    const webchatBranch = source.indexOf("if (isWebChatMode()) {", switchStart);
    const clearHistory = source.indexOf(
      "chatHistory.set(resolvedConversationKey, []);",
      webchatBranch,
    );
    const markIsolated = source.indexOf(
      "webChatIsolatedConversationKeys.add(resolvedConversationKey);",
      webchatBranch,
    );
    const markLoaded = source.indexOf(
      "loadedConversationKeys.add(resolvedConversationKey);",
      webchatBranch,
    );
    const normalLoad = source.indexOf(
      "await ensureConversationLoaded(item as Zotero.Item);",
      webchatBranch,
    );

    assert.isAtLeast(switchStart, 0);
    assert.isAtLeast(webchatBranch, switchStart);
    assert.isAtLeast(markIsolated, webchatBranch);
    assert.isAtLeast(clearHistory, markIsolated);
    assert.isAtLeast(markLoaded, clearHistory);
    assert.isAtLeast(normalLoad, markLoaded);
  });

  it("blocks persisted paper history hydration while webchat is active", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/chat.ts"),
      "utf8",
    );
    const ensureStart = source.indexOf(
      "export async function ensureConversationLoaded",
    );
    const webchatGuard = source.indexOf(
      "isEffectiveWebChatRequest(item)",
      ensureStart,
    );
    const isolateCall = source.indexOf(
      "isolateWebChatConversationKey(",
      webchatGuard,
    );
    const loadedShortcut = source.indexOf(
      "if (loadedConversationKeys.has(conversationKey)) return;",
      ensureStart,
    );
    const storedLoad = source.indexOf(
      "loadStoredConversationByKey",
      ensureStart,
    );
    const lateIsolationCheck = source.indexOf(
      "webChatIsolatedConversationKeys.has(conversationKey)",
      storedLoad,
    );

    assert.isAtLeast(ensureStart, 0);
    assert.isAtLeast(webchatGuard, ensureStart);
    assert.isAtLeast(isolateCall, webchatGuard);
    assert.isBelow(isolateCall, loadedShortcut);
    assert.isBelow(loadedShortcut, storedLoad);
    assert.isAtLeast(lateIsolationCheck, storedLoad);
  });

  it("keeps webchat turns out of persistent chat storage", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/chat.ts"),
      "utf8",
    );
    const flag = source.indexOf(
      'const shouldPersistTurn =\n    effectiveRequestConfig.providerProtocol !== "web_sync";',
    );
    const userPersist = source.indexOf(
      "if (shouldPersistTurn) {\n    void persistConversationMessage(",
      flag,
    );
    const assistantPersist = source.indexOf(
      "if (!shouldPersistTurn) return;",
      flag,
    );
    const webchatPipeline = source.indexOf(
      'if (effectiveRequestConfig.providerProtocol === "web_sync")',
      assistantPersist,
    );

    assert.isAtLeast(flag, 0);
    assert.isAtLeast(userPersist, flag);
    assert.isAtLeast(assistantPersist, userPersist);
    assert.isAtLeast(webchatPipeline, assistantPersist);
  });

  it("enters webchat through paper chat instead of library chat", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/setupHandlers.ts"),
      "utf8",
    );
    const entryStart = source.indexOf(
      'if (entry.authMode === "webchat" && !wasWebChat)',
    );
    const entryBlockEnd = source.indexOf(
      "// Show preloading screen to verify connectivity before enabling webchat",
      entryStart,
    );
    const entryBlock = source.slice(entryStart, entryBlockEnd);
    const paperSwitch = entryBlock.indexOf(
      "await createAndSwitchPaperConversation();",
    );
    const webchatInit = entryBlock.indexOf(
      "initializeWebChatConversationForCurrentItem();",
    );

    assert.isAtLeast(entryStart, 0);
    assert.isAbove(entryBlockEnd, entryStart);
    assert.isAtLeast(paperSwitch, 0);
    assert.isAtLeast(webchatInit, 0);
    assert.isBelow(paperSwitch, webchatInit);
    assert.notInclude(entryBlock, "createAndSwitchGlobalConversation");
  });

  it("does not restore normal paper history on webchat panel startup", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/setupHandlers.ts"),
      "utf8",
    );
    const restoreStart = source.indexOf(
      "restoreDraftInputForCurrentConversation();",
    );
    const webchatBranch = source.indexOf(
      "} else if (isWebChatMode()) {",
      restoreStart,
    );
    const paperBranch = source.indexOf(
      "} else if (isPaperMode()) {",
      webchatBranch,
    );
    const webchatBlock = source.slice(webchatBranch, paperBranch);

    assert.isAtLeast(restoreStart, 0);
    assert.isAtLeast(webchatBranch, restoreStart);
    assert.isAbove(paperBranch, webchatBranch);
    assert.include(
      webchatBlock,
      "initializeWebChatConversationForCurrentItem();",
    );
    assert.notInclude(webchatBlock, "switchPaperConversation()");
  });
});
