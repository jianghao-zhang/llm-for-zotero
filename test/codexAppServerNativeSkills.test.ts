import { assert } from "chai";
import {
  buildCodexNativeSkillInstructionBlock,
  buildCodexNativeSkillRequest,
  clearCodexNativeSkillClassifierCache,
  resolveExplicitCodexNativeSkillIds,
  resolveCodexNativeSkills,
} from "../src/codexAppServer/nativeSkills";
import {
  BUILTIN_SKILL_FILES,
  parseSkill,
  setUserSkills,
} from "../src/agent/skills";
import type { AgentSkill } from "../src/agent/skills/skillLoader";

function makeSkill(
  id: string,
  pattern: RegExp,
  instruction: string,
): AgentSkill {
  return {
    id,
    description: `${id} description`,
    version: 1,
    patterns: [pattern],
    contexts: ["any"],
    activation: "auto",
    instruction,
    source: "system",
  };
}

describe("Codex native skills", function () {
  afterEach(function () {
    setUserSkills([]);
    clearCodexNativeSkillClassifierCache();
  });

  it("includes forced skill IDs even when classifier returns no match", async function () {
    setUserSkills([
      makeSkill("write-note", /write note/i, "Write-note instructions."),
      makeSkill("compare-papers", /compare/i, "Compare instructions."),
    ]);

    let classifierCalls = 0;
    const resolved = await resolveCodexNativeSkills({
      scope: {
        conversationKey: 1,
        libraryID: 7,
        kind: "global",
      },
      userText: "Tag this paper.",
      model: "gpt-5.4",
      apiBase: "",
      skillContext: { forcedSkillIds: ["write-note"] },
      detectSkillIntentImpl: async () => {
        classifierCalls += 1;
        return [];
      },
    });

    assert.deepEqual(resolved.matchedSkillIds, ["write-note"]);
    assert.equal(classifierCalls, 0);
    assert.include(resolved.instructionBlock, "Skill: write-note");
    assert.include(resolved.instructionBlock, "Write-note instructions.");
  });

  it("resolves only known explicit skill IDs in the user's selection order", function () {
    setUserSkills([
      makeSkill("write-note", /write note/i, "Write-note instructions."),
      makeSkill("compare-papers", /compare/i, "Compare instructions."),
    ]);

    assert.deepEqual(
      resolveExplicitCodexNativeSkillIds([
        "missing-skill",
        "compare-papers",
        "write-note",
        "compare-papers",
      ]),
      ["compare-papers", "write-note"],
    );
  });

  it("uses deterministic regex matching without a classifier call", async function () {
    setUserSkills([
      makeSkill("write-note", /note/i, "Write-note instructions."),
      makeSkill("compare-papers", /compare/i, "Compare instructions."),
    ]);

    let classifierCalls = 0;
    const resolved = await resolveCodexNativeSkills({
      scope: {
        conversationKey: 1,
        libraryID: 7,
        kind: "global",
      },
      userText: "Please compare these papers.",
      model: "",
      apiBase: "",
      detectSkillIntentImpl: async () => {
        classifierCalls += 1;
        return ["write-note"];
      },
    });

    assert.deepEqual(resolved.matchedSkillIds, ["compare-papers"]);
    assert.equal(classifierCalls, 0);
    assert.include(resolved.instructionBlock, "Skill: compare-papers");
    assert.notInclude(resolved.instructionBlock, "Skill: write-note");
  });

  it("uses cached classifier fallback for ambiguous multilingual skill turns", async function () {
    setUserSkills([
      makeSkill("write-note", /write note/i, "Write-note instructions."),
    ]);
    let classifierCalls = 0;
    const params = {
      scope: {
        conversationKey: 1,
        libraryID: 7,
        kind: "global" as const,
        activeNoteId: 42,
        activeNoteTitle: "Draft",
      },
      userText: "帮我整理一下",
      model: "gpt-5.4",
      apiBase: "",
      detectSkillIntentImpl: async () => {
        classifierCalls += 1;
        return ["write-note"];
      },
    };

    const first = await resolveCodexNativeSkills(params);
    const second = await resolveCodexNativeSkills(params);

    assert.deepEqual(first.matchedSkillIds, ["write-note"]);
    assert.deepEqual(second.matchedSkillIds, ["write-note"]);
    assert.equal(classifierCalls, 1);
    assert.equal(second.resolutionSource, "cache");
  });

  it("returns no instruction block when no skills are loaded", async function () {
    setUserSkills([]);

    const resolved = await resolveCodexNativeSkills({
      scope: {
        conversationKey: 1,
        libraryID: 7,
        kind: "global",
      },
      userText: "Summarize my library.",
      model: "gpt-5.4",
      apiBase: "",
    });

    assert.deepEqual(resolved.matchedSkillIds, []);
    assert.equal(resolved.instructionBlock, "");
  });

  it("does not auto-route retained capability skills in native turns", async function () {
    setUserSkills(
      Object.values(BUILTIN_SKILL_FILES).map((raw) => parseSkill(raw)),
    );

    const resolved = await resolveCodexNativeSkills({
      scope: {
        conversationKey: 1,
        libraryID: 7,
        kind: "paper",
        paperItemID: 42,
        activeContextItemId: 99,
        paperTitle: "Paper",
      },
      userText: "analyze figure 2 and save it as a note",
      model: "",
      apiBase: "",
    });

    assert.deepEqual(resolved.matchedSkillIds, []);
    assert.equal(resolved.instructionBlock, "");
  });

  it("builds native request context from scope and UI context", function () {
    const request = buildCodexNativeSkillRequest({
      scope: {
        conversationKey: 123,
        libraryID: 7,
        kind: "paper",
        paperItemID: 42,
        activeContextItemId: 99,
        paperTitle: "Native Skills Paper",
        activeNoteId: 55,
        activeNoteKind: "item",
        activeNoteTitle: "Draft note",
      },
      userText: "Analyze figure 1.",
      model: "gpt-5.4",
      apiBase: "",
      skillContext: {
        selectedTexts: ["Figure caption"],
        screenshots: ["data:image/png;base64,AAAA"],
      },
    });

    assert.equal(request.authMode, "codex_app_server");
    assert.equal(request.providerProtocol, "codex_responses");
    assert.equal(request.activeItemId, 42);
    assert.deepEqual(request.selectedPaperContexts, [
      {
        itemId: 42,
        contextItemId: 99,
        title: "Native Skills Paper",
      },
    ]);
    assert.equal(request.activeNoteContext?.noteId, 55);
    assert.deepEqual(request.selectedTexts, ["Figure caption"]);
    assert.deepEqual(request.screenshots, ["data:image/png;base64,AAAA"]);
  });

  it("carries raw PDF identity into skill routing and makes its policy final", function () {
    const localDocument = {
      kind: "local_pdf" as const,
      sourceKey: "zotero-pdf:42:99" as const,
      itemId: 42,
      contextItemId: 99,
      title: "Native Skills Paper",
      name: "paper.pdf",
      mimeType: "application/pdf" as const,
      absolutePath: "/papers/paper.pdf",
    };
    const request = buildCodexNativeSkillRequest({
      scope: {
        conversationKey: 123,
        libraryID: 7,
        kind: "paper",
        paperItemID: 42,
        activeContextItemId: 99,
        paperTitle: "Native Skills Paper",
      },
      userText: "Summarize this paper.",
      model: "gpt-5.6-sol",
      apiBase: "",
      skillContext: {
        pdfPaperContexts: [
          {
            itemId: 42,
            contextItemId: 99,
            title: "Native Skills Paper",
            contentSourceMode: "pdf",
          },
        ],
        localDocuments: [localDocument],
      },
    });
    const block = buildCodexNativeSkillInstructionBlock(
      ["simple-paper-qa"],
      [makeSkill("simple-paper-qa", /summarize/i, "Call paper_read overview.")],
      { rawPdfMode: true },
    );

    assert.deepEqual(
      request.pdfPaperContexts?.map((paper) => [
        paper.itemId,
        paper.contextItemId,
      ]),
      [[42, 99]],
    );
    assert.deepEqual(request.localDocuments, [localDocument]);
    assert.include(block, "Call paper_read overview.");
    assert.include(block, "overrides conflicting paper-reading routes");
    assert.notInclude(
      block,
      "overrides ordinary paper-reading and skill guidance",
    );
    assert.match(
      block,
      /Raw PDF transport policy[\s\S]*Do not use `paper_read`[\s\S]*$/,
    );
  });

  it("omits the skill block when matched IDs do not resolve to loaded skills", function () {
    assert.equal(
      buildCodexNativeSkillInstructionBlock(["missing-skill"], []),
      "",
    );
  });
});
