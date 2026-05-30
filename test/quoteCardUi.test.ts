import { assert } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(resolve(here, "..", path), "utf8");
}

describe("quote card UI contract", function () {
  it("defines expandable quote-card styling", function () {
    const css = source("addon/content/zoteroPane.css");

    assert.include(css, ".llm-quote-card");
    assert.include(css, ".llm-quote-card-header");
    assert.include(css, ".llm-quote-card-body");
    assert.include(css, '.llm-quote-card[data-expanded="false"]');
    assert.include(css, '"toggle title citation"');
    assert.include(css, '". preview preview"');
    assert.include(css, "-webkit-line-clamp: 2");
  });

  it("keeps citation activation separate from quote-card toggling", function () {
    const renderSource = source(
      "src/modules/contextPanel/assistantCitationLinks.ts",
    );

    assert.include(renderSource, "createQuoteCardElement");
    assert.include(renderSource, 'textSpan.setAttribute("role", "button")');
    assert.include(renderSource, "handleCitationMouseDown");
    assert.include(renderSource, "event.stopPropagation();");
    assert.include(renderSource, "toggleExpanded();");
    assert.include(
      renderSource,
      ".llm-citation-row, .llm-citation-inline-wrap",
    );
  });
});
