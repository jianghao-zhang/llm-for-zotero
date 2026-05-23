import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assert } from "chai";

const here = dirname(fileURLToPath(import.meta.url));

describe("compact marker CSS", function () {
  it("defines native-style pending and completed divider states", function () {
    const css = readFileSync(
      resolve(here, "../addon/content/zoteroPane.css"),
      "utf8",
    );

    assert.include(css, ".llm-compact-marker-wrapper");
    assert.include(css, ".llm-bubble.llm-compact-marker");
    assert.include(css, ".llm-compact-marker-rule");
    assert.include(css, ".llm-compact-marker-pending");
    assert.include(css, "@keyframes llm-compact-spin");
  });
});
