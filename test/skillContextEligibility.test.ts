import { assert } from "chai";
import {
  BUILTIN_SKILL_FILES,
  getMatchedSkillIds,
  parseSkill,
  setUserSkills,
} from "../src/agent/skills";

function loadBuiltInSkills(): void {
  setUserSkills(
    Object.values(BUILTIN_SKILL_FILES).map((raw) => parseSkill(raw)),
  );
}

describe("skill context eligibility", function () {
  afterEach(function () {
    setUserSkills([]);
  });

  it("keeps every shipped Zotero capability skill manual-only", function () {
    const skills = Object.values(BUILTIN_SKILL_FILES).map((raw) =>
      parseSkill(raw),
    );
    assert.deepEqual(
      skills.map((skill) => skill.id).sort(),
      ["analyze-figures", "import-to-library", "write-note"],
    );
    assert.isTrue(skills.every((skill) => skill.activation === "manual"));
  });

  it("does not activate shipped skills from ordinary paper questions", function () {
    loadBuiltInSkills();

    for (const userText of [
      "summarize this paper",
      "compare these papers",
      "write a literature review",
      "analyze figure 2",
      "save this as a note",
      "import this paper into Zotero",
    ]) {
      assert.deepEqual(getMatchedSkillIds({ userText }), []);
    }
  });

  it("honors an explicitly selected retained skill", function () {
    loadBuiltInSkills();

    assert.deepEqual(
      getMatchedSkillIds({
        userText: "inspect the current figure",
        forcedSkillIds: ["analyze-figures"],
      }),
      ["analyze-figures"],
    );
  });

  it("does not expose retired reasoning workflow skills", function () {
    assert.deepEqual(
      Object.keys(BUILTIN_SKILL_FILES).sort(),
      ["analyze-figures.md", "import-cited-reference.md", "write-note.md"],
    );
    for (const filename of [
      "simple-paper-qa.md",
      "evidence-based-qa.md",
      "compare-papers.md",
      "library-analysis.md",
      "literature-review.md",
    ]) {
      assert.notProperty(BUILTIN_SKILL_FILES, filename);
    }
  });

  it("keeps personal auto skills backward compatible", function () {
    setUserSkills([
      parseSkill(
        [
          "---",
          "id: custom-summary",
          "description: Custom summary",
          "version: 1",
          "activation: auto",
          "match: /summarize/i",
          "---",
          "Custom instructions.",
        ].join("\n"),
      ),
    ]);

    assert.deepEqual(
      getMatchedSkillIds({ userText: "summarize anything" }),
      ["custom-summary"],
    );
  });
});
