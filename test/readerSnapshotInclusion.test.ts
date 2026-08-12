import { assert } from "chai";
import {
  appendReaderSnapshotComment,
  appendReaderSnapshotImage,
} from "../src/modules/contextPanel/readerSnapshotInclusion";

describe("reader snapshot inclusion", function () {
  it("appends a captured image without disturbing existing screenshots", function () {
    assert.deepEqual(
      appendReaderSnapshotImage({
        existingImages: ["data:image/png;base64,old"],
        image: "data:image/png;base64,new",
        maxImages: 50,
      }),
      ["data:image/png;base64,old", "data:image/png;base64,new"],
    );
  });

  it("does not exceed the screenshot limit", function () {
    assert.deepEqual(
      appendReaderSnapshotImage({
        existingImages: ["old"],
        image: "new",
        maxImages: 1,
      }),
      ["old"],
    );
  });

  it("preserves an existing draft when adding the optional comment", function () {
    assert.equal(
      appendReaderSnapshotComment({
        existingDraft: "Compare these results",
        comment: "Focus on the orange feedback path",
      }),
      "Compare these results\n\nScreenshot note: Focus on the orange feedback path",
    );
  });

  it("leaves the draft unchanged for a blank optional comment", function () {
    assert.equal(
      appendReaderSnapshotComment({
        existingDraft: "Existing question",
        comment: "  ",
      }),
      "Existing question",
    );
  });
});
