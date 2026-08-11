import { assert } from "chai";
import {
  buildQuestionWithSelectedTextContexts,
  setTokenUsage,
} from "../src/modules/contextPanel/textUtils";

describe("textUtils selected text prompt composition", function () {
  it("includes paper attribution for open-chat prompt composition", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["A selected text snippet."],
      ["pdf"],
      "What does this mean?",
      {
        includePaperAttribution: true,
        selectedTextPaperContexts: [
          {
            itemId: 11,
            contextItemId: 12,
            title: "Paper",
            firstCreator: "Smith et al.",
            year: "2021",
          },
        ],
      },
    );
    assert.include(prompt, "[paper=Smith et al., 2021]");
    assert.include(prompt, "[source_label=(Smith et al., 2021)]");
    assert.include(
      prompt,
      "Paper-grounded citation format for the final answer:",
    );
    assert.include(prompt, "User question:\nWhat does this mean?");
  });

  it("keeps legacy single-pdf prompt shape when attribution is not requested", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["A selected text snippet."],
      ["pdf"],
      "What does this mean?",
    );
    assert.include(prompt, "Selected text from the PDF reader:");
    assert.notInclude(prompt, "[paper=");
  });

  it("keeps an optional comment attached to its selected text", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["A selected text snippet."],
      ["pdf"],
      "What does this mean?",
      {
        selectedTextContexts: [
          {
            text: "A selected text snippet.",
            source: "pdf",
            comment: "Check whether the evidence really supports this.",
          },
        ],
      },
    );

    assert.include(
      prompt,
      "User comment on this selected text:\nCheck whether the evidence really supports this.",
    );
    assert.include(prompt, "User question:\nWhat does this mean?");
  });

  it("keeps comments paired with the right context", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["First quote.", "Second quote."],
      ["pdf", "pdf"],
      "Compare them.",
      {
        selectedTextContexts: [
          {
            text: "First quote.",
            source: "pdf",
            comment: "Question about the first quote.",
          },
          {
            text: "Second quote.",
            source: "pdf",
            comment: "Question about the second quote.",
          },
        ],
      },
    );

    assert.match(
      prompt,
      /First quote\.\n"""\nUser comment for this context:\nQuestion about the first quote\./,
    );
    assert.match(
      prompt,
      /Second quote\.\n"""\nUser comment for this context:\nQuestion about the second quote\./,
    );
  });

  it("uses note-edit wording for active note editing focus", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["Revise this paragraph."],
      ["note-edit"],
      "Make it clearer.",
    );
    assert.include(
      prompt,
      "Selected text from the current Zotero note editor (editing focus):",
    );
    assert.include(
      prompt,
      "The user selected this snippet inside the active note and wants help editing it in place.",
    );
    assert.include(prompt, "User question:\nMake it clearer.");
  });

  it("uses note wording for selected Zotero note context", function () {
    const prompt = buildQuestionWithSelectedTextContexts(
      ["Draft note content."],
      ["note"],
      "Use this for context.",
    );
    assert.include(prompt, "Selected text from a Zotero note:");
    assert.notInclude(prompt, "editing focus");
    assert.include(prompt, "User question:\nUse this for context.");
  });

  it("labels token usage as estimated active context pressure", function () {
    const tokenEl = {
      textContent: "",
      title: "",
      dataset: {} as Record<string, string>,
      style: { display: "" },
    } as unknown as HTMLElement;
    const gaugeEl = {
      title: "",
      dataset: {} as Record<string, string>,
      style: { display: "", background: "" },
    } as unknown as HTMLElement;

    setTokenUsage(tokenEl, 90, 100, gaugeEl, { estimated: true });

    assert.equal(tokenEl.textContent, "90 / 100 (90%)");
    assert.include(tokenEl.title, "Estimated active context window usage");
    assert.equal(tokenEl.dataset.warning, "true");
  });
});
