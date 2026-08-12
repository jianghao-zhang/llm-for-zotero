import { assert } from "chai";

import { resolveZoteroAttachmentFilePath } from "../src/modules/contextPanel/attachmentStorage";

describe("attachmentStorage", function () {
  it("uses Zotero's asynchronous existing-file path for snapshots", async function () {
    let syncCalls = 0;
    const item = {
      isAttachment: () => true,
      getFilePathAsync: async () => "/storage/snapshot.html",
      getFilePath: () => {
        syncCalls += 1;
        return false;
      },
    } as unknown as Zotero.Item;

    assert.equal(
      await resolveZoteroAttachmentFilePath(item),
      "/storage/snapshot.html",
    );
    assert.equal(syncCalls, 0);
  });

  it("keeps compatibility with attachments exposing only the sync path", async function () {
    const item = {
      isAttachment: () => true,
      getFilePath: () => "/storage/legacy.html",
    } as unknown as Zotero.Item;

    assert.equal(
      await resolveZoteroAttachmentFilePath(item),
      "/storage/legacy.html",
    );
  });

  it("returns null when the attachment is not available locally", async function () {
    const item = {
      isAttachment: () => true,
      getFilePathAsync: async () => false,
      getFilePath: () => false,
    } as unknown as Zotero.Item;

    assert.isNull(await resolveZoteroAttachmentFilePath(item));
  });
});
