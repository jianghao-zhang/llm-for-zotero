import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "chai";

const here = dirname(fileURLToPath(import.meta.url));

describe("independent reader context pane structure", function () {
  it("uses a top-level ContextPane deck child instead of an ItemPane section", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/readerContextPane.ts"),
      "utf8",
    );
    const panelIndex = source.indexOf('"zotero-context-pane-deck"');
    const appendIndex = source.indexOf("deck.append(panel)");

    assert.isAtLeast(panelIndex, 0);
    assert.isAbove(appendIndex, panelIndex);
    assert.notMatch(source, /ItemPaneManager\./);
    assert.include(source, "doc.createXULElement(\"vbox\")");
  });

  it("keeps the custom side-nav trigger outside Zotero's data-pane routing", function () {
    const source = readFileSync(
      resolve(here, "../src/modules/contextPanel/readerContextPane.ts"),
      "utf8",
    );

    assert.include(source, "createSidenavButton");
    assert.notInclude(source, "button.dataset.pane");
    assert.include(source, "state.wrapper.remove()");
    assert.include(source, "state.panel.remove()");
    assert.include(source, "renderer.dispose?.(state.panel)");
    assert.include(source, "zotero-context-pane-item-deck");
  });

  it("keeps the independent pane composer away from the ContextPane edge", function () {
    const css = readFileSync(
      resolve(here, "../addon/content/zoteroPane.css"),
      "utf8",
    );

    assert.match(
      css,
      /#llmforzotero-reader-context-panel\s*>\s*\.llm-panel\s*>\s*\.llm-input-section\s*\{[^}]*margin-inline:\s*10px;/s,
    );
  });
});
