import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "chai";

const here = dirname(fileURLToPath(import.meta.url));

describe("Codex native compact send path", function () {
  it("intercepts /compact before persistence or native turns", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/chat.ts"),
      "utf8",
    );
    const compactBranch = source.indexOf("if (isCodexNativeCompactCommand)");
    const userPersist = source.indexOf(
      'role: "user",',
      source.indexOf("void persistConversationMessage(conversationKey"),
    );
    const nativeTurn = source.indexOf(
      "await runCodexAppServerNativeTurn",
      compactBranch,
    );
    const nativeCompact = source.indexOf(
      "await compactCodexAppServerConversation",
      compactBranch,
    );
    const attachmentNormalization = source.indexOf(
      "const requestFileAttachments",
    );

    assert.isAtLeast(compactBranch, 0);
    assert.isAtLeast(nativeCompact, compactBranch);
    assert.isBelow(compactBranch, userPersist);
    assert.isBelow(compactBranch, attachmentNormalization);
    assert.isBelow(nativeCompact, nativeTurn);
  });
});
