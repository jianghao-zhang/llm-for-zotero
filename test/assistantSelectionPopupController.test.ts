import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert } from "chai";

const controllerSource = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/contextPanel/setupHandlers/controllers/assistantSelectionPopupController.ts",
  ),
  "utf8",
);

describe("assistant selection popup controller", function () {
  it("submits one quote per semantic click", function () {
    assert.include(
      controllerSource,
      'quoteButton.addEventListener("pointerdown", preserveQuoteSelection)',
    );
    assert.include(
      controllerSource,
      'quoteButton.addEventListener("mousedown", preserveQuoteSelection)',
    );
    assert.include(
      controllerSource,
      'quoteButton.addEventListener("click", triggerSelectionPopupAction)',
    );
    assert.notInclude(
      controllerSource,
      'quoteButton.addEventListener("command", triggerSelectionPopupAction)',
    );
    assert.notInclude(controllerSource, "selectionPopupHandled");
  });

  it("reopens comment mode for an already included response quote", function () {
    assert.include(controllerSource, "const alreadyIncluded =");
    assert.include(
      controllerSource,
      'context.source === "model" && context.text === selected',
    );
    assert.include(
      controllerSource,
      'setStatus(status, "Selected response text already included", "ready")',
    );
    assert.include(
      controllerSource,
      "showCommentComposer(activeItemId, selected)",
    );
  });

  it("keeps an active comment composer open during layout scroll", function () {
    assert.include(
      controllerSource,
      "if (commentModeActive) {\n      panelWin?.requestAnimationFrame(fitCommentPopupWithinChat);\n      return;",
    );
  });
});
