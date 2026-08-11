import { assert } from "chai";

import { shouldDefaultOpenReaderPaneForTabEvent } from "../src/modules/contextPanel/readerContextPane";

describe("reader context pane default opening", function () {
  it("opens for the selected reader when its asynchronous load completes", function () {
    assert.isTrue(
      shouldDefaultOpenReaderPaneForTabEvent({
        event: "load",
        type: "tab",
        ids: ["reader-1"],
        selectedTabID: "reader-1",
        extraData: { "reader-1": { type: "reader" } },
      }),
    );
  });

  it("does not steal focus on ordinary tab selection", function () {
    assert.isFalse(
      shouldDefaultOpenReaderPaneForTabEvent({
        event: "select",
        type: "tab",
        ids: ["reader-1"],
        selectedTabID: "reader-1",
        extraData: { "reader-1": { type: "reader" } },
      }),
    );
  });

  it("ignores stale loads and non-reader tabs", function () {
    assert.isFalse(
      shouldDefaultOpenReaderPaneForTabEvent({
        event: "load",
        type: "tab",
        ids: ["reader-old"],
        selectedTabID: "reader-new",
        extraData: { "reader-old": { type: "reader" } },
      }),
    );
    assert.isFalse(
      shouldDefaultOpenReaderPaneForTabEvent({
        event: "load",
        type: "tab",
        ids: ["library"],
        selectedTabID: "library",
        extraData: { library: { type: "library" } },
      }),
    );
  });
});
