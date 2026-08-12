import { assert } from "chai";
import {
  appendScreenshotCommentsToPrompt,
  parseScreenshotContexts,
  serializeScreenshotContexts,
} from "../src/modules/contextPanel/screenshotComments";

describe("screenshot comments", function () {
  it("round-trips legacy images and per-image comments in one storage column", function () {
    const serialized = serializeScreenshotContexts(
      ["old", "new"],
      ["", "focus on the feedback path"],
    );
    assert.deepEqual(parseScreenshotContexts(serialized), {
      images: ["old", "new"],
      comments: ["", "focus on the feedback path"],
    });
    assert.deepEqual(parseScreenshotContexts('["legacy"]'), {
      images: ["legacy"],
      comments: [""],
    });
  });

  it("adds comments to the model prompt without changing the visible draft", function () {
    assert.equal(
      appendScreenshotCommentsToPrompt("Compare the figures", ["", "Why?"]),
      "Compare the figures\n\nScreenshot comments:\nScreenshot 2: Why?",
    );
  });
});
