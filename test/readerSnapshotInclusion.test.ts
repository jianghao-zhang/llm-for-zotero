import { assert } from "chai";
import { appendReaderSnapshotImage } from "../src/modules/contextPanel/readerSnapshotInclusion";

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
});
