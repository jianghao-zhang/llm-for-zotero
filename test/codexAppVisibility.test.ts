import { assert } from "chai";
import {
  buildCodexAppTasksReloadFrame,
  notifyCodexAppTasksChanged,
  resolveCodexAppIpcSocketPath,
} from "../src/codexAppServer/appVisibility";

describe("Codex App visibility bridge", function () {
  it("resolves the shared Codex IPC socket from the configured home", function () {
    assert.equal(
      resolveCodexAppIpcSocketPath({ codexHome: "/tmp/custom-codex/" }),
      "/tmp/custom-codex/ipc/ipc.sock",
    );
    assert.equal(
      resolveCodexAppIpcSocketPath({ homeDir: "/Users/example/" }),
      "/Users/example/.codex/ipc/ipc.sock",
    );
  });

  it("frames a task-cache invalidation broadcast for the Codex App", function () {
    const frame = buildCodexAppTasksReloadFrame();
    const payloadLength = new DataView(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength,
    ).getUint32(0, true);
    assert.equal(payloadLength, frame.byteLength - 4);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(frame.subarray(4))), {
      type: "broadcast",
      method: "query-cache-invalidate",
      sourceClientId: "llm-for-zotero",
      version: 0,
      params: { queryKey: ["tasks"] },
    });
  });

  it("writes the refresh frame without opening or focusing Codex", async function () {
    let observedPath = "";
    let observedFrame: Uint8Array | undefined;
    assert.isTrue(
      await notifyCodexAppTasksChanged({
        codexHome: "/tmp/custom-codex",
        writeFrame: (path, frame) => {
          observedPath = path;
          observedFrame = frame;
        },
      }),
    );
    assert.equal(observedPath, "/tmp/custom-codex/ipc/ipc.sock");
    assert.isAbove(observedFrame?.byteLength || 0, 4);
  });
});
