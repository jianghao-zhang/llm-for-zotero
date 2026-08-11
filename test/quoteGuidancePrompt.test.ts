import { readFileSync } from "node:fs";
import { assert } from "chai";
import { buildZoteroEnvironmentManifest } from "../src/codexAppServer/nativeClient";
import {
  buildAgentEvidenceContextBlock,
  clearAgentEvidenceCache,
  commitAgentCacheEvidenceActivities,
} from "../src/agent/context/cacheManagement";
import { buildAgentStableResourceContextBlock } from "../src/agent/context/resourceContextPlan";
import { AGENT_PERSONA_INSTRUCTIONS } from "../src/agent/model/agentPersona";
import { buildAgentInitialMessages } from "../src/agent/model/messageBuilder";
import {
  buildGenericSourceQuoteCitationGuidance,
  buildPaperQuoteCitationGuidance,
} from "../src/modules/contextPanel/paperAttribution";
import { BALANCED_EVIDENCE_GUIDANCE } from "../src/shared/quoteGuidance";
import { DEFAULT_SYSTEM_PROMPT } from "../src/utils/llmDefaults";
import type { AgentRuntimeRequest } from "../src/agent/types";
import type { PaperContextRef } from "../src/shared/types";

const BALANCED_EVIDENCE_PHRASES = [
  "important paper-specific claims checkable",
  "not to decorate every paragraph",
  "repetitive citations or low-information quotes",
  "not use them for publication metadata, DOI links, journal names, or source labels alone",
  "Paper titles, headings, author lists, journal names, DOI blocks, and source labels are metadata, not direct evidence",
];

const EVIDENCE_TO_EXPLANATION_PHRASES = [
  "Use retrieved paper text as evidence for reasoning, not as material to rewrite",
  "quote or anchor 1-3 high-signal snippets",
  "After a direct quote, do not merely paraphrase it",
  "A useful quote should do real work",
  "Never use quotes as decoration or as a substitute for reasoning",
];

const SOURCE_LABEL_PLACEMENT_PHRASES = [
  "Do not append a standalone source label or citation-only final line",
  "source labels on their own line belong only after direct blockquotes",
];

const STRICT_BLOCKQUOTE_SOURCE_PHRASES = [
  "`>` Markdown blockquotes are reserved only for direct original source text",
  "Verified quote anchors are available only for direct source quotes",
  "For interpretation, emphasis, examples, or opinion, use normal prose or fenced `text` blocks",
];

const DIRECT_QUOTE_SAFETY_PHRASES = [
  "Direct quote text must be copied verbatim in the original source language",
  "Copy the Source label string exactly",
  "Do not invent author/year/page/section labels",
  "[[source=...]]",
  "section=...",
  "chunk=...",
];

function assertBalancedEvidenceGuidance(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of BALANCED_EVIDENCE_PHRASES) {
    assert.include(normalized, phrase);
  }
  assertEvidenceToExplanationGuidance(text);
  assertSourceLabelPlacementGuidance(text);
  assertStrictBlockquoteSourceGuidance(text);
}

function assertEvidenceToExplanationGuidance(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of EVIDENCE_TO_EXPLANATION_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function assertSourceLabelPlacementGuidance(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of SOURCE_LABEL_PLACEMENT_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function assertStrictBlockquoteSourceGuidance(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of STRICT_BLOCKQUOTE_SOURCE_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function assertDirectQuoteSafety(text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of DIRECT_QUOTE_SAFETY_PHRASES) {
    assert.include(normalized, phrase);
  }
}

function paper(): PaperContextRef {
  return {
    itemId: 11,
    contextItemId: 12,
    title: "Prompt Paper",
    firstCreator: "Smith",
    year: "2024",
  };
}

function request(): AgentRuntimeRequest {
  const paperContext = paper();
  return {
    conversationKey: 909,
    mode: "agent",
    userText: "Explain the method.",
    activeItemId: paperContext.itemId,
    libraryID: 1,
    selectedPaperContexts: [paperContext],
  };
}

function readSkill(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("quote guidance prompts", function () {
  afterEach(function () {
    clearAgentEvidenceCache();
  });

  it("centralizes the balanced evidence wording for runtime prompts", function () {
    assertBalancedEvidenceGuidance(BALANCED_EVIDENCE_GUIDANCE);
  });

  it("keeps direct chat evidence guidance compact and citation-safe", function () {
    assert.include(DEFAULT_SYSTEM_PROMPT, "Ground paper-specific claims");
    assert.include(DEFAULT_SYSTEM_PROMPT, "distinguish source claims");
    assert.include(DEFAULT_SYSTEM_PROMPT, "short verbatim quotes only");
    assert.include(DEFAULT_SYSTEM_PROMPT, "[[quote:...]]");
    assert.include(DEFAULT_SYSTEM_PROMPT, "sourceLabel strings exactly");
    assert.include(DEFAULT_SYSTEM_PROMPT, "never invent pages");
    assert.notInclude(DEFAULT_SYSTEM_PROMPT, "Example source quote");
    assert.notInclude(DEFAULT_SYSTEM_PROMPT, "1-3 high-signal snippets");
  });

  it("includes balanced evidence guidance in the core agent persona", function () {
    const text = AGENT_PERSONA_INSTRUCTIONS.join("\n");
    assert.include(text, BALANCED_EVIDENCE_GUIDANCE);
    assertDirectQuoteSafety(text);
  });

  it("includes balanced evidence guidance in Codex native MCP instructions", function () {
    const manifest = buildZoteroEnvironmentManifest({
      scope: {
        conversationKey: 1,
        libraryID: 1,
        kind: "paper",
        paperItemID: 11,
        activeItemId: 11,
        activeContextItemId: 12,
        paperTitle: "Prompt Paper",
      },
      mcpEnabled: true,
      mcpReady: true,
    });

    assertBalancedEvidenceGuidance(manifest);
    assertDirectQuoteSafety(manifest);
  });

  it("includes balanced evidence guidance in stable resource context", function () {
    const text = buildAgentStableResourceContextBlock(request());
    assertBalancedEvidenceGuidance(text);
    assertDirectQuoteSafety(text);
  });

  it("includes balanced evidence guidance in paper and source quote helpers", function () {
    const paperGuidance = buildPaperQuoteCitationGuidance(paper()).join("\n");
    const genericGuidance =
      buildGenericSourceQuoteCitationGuidance().join("\n");

    assertBalancedEvidenceGuidance(paperGuidance);
    assertDirectQuoteSafety(paperGuidance);
    assertBalancedEvidenceGuidance(genericGuidance);
    assertDirectQuoteSafety(genericGuidance);
  });

  it("includes balanced evidence guidance in preserved evidence context", async function () {
    const req = request();
    await commitAgentCacheEvidenceActivities({
      conversationKey: req.conversationKey,
      activities: [
        {
          toolName: "paper_read",
          toolLabel: "Read Paper",
          input: { mode: "targeted", query: "method" },
          content: {
            papers: [
              {
                paperContext: paper(),
                sourceKind: "paper_text",
                passages: [
                  {
                    text: "The method used a controlled task.",
                    sourceLabel: "(Smith, 2024)",
                  },
                ],
              },
            ],
          },
          request: req,
          timestamp: 1,
        },
      ],
    });

    const text = buildAgentEvidenceContextBlock({
      conversationKey: req.conversationKey,
      request: req,
    });

    assertBalancedEvidenceGuidance(text);
    assertDirectQuoteSafety(text);
  });

  it("keeps citation binding outside retired reasoning workflow skills", function () {
    const skills = [
      "../src/agent/skills/analyze-figures.md",
      "../src/agent/skills/write-note.md",
      "../src/agent/skills/import-cited-reference.md",
    ];

    for (const skill of skills) {
      const text = readSkill(skill);
      assert.include(text, "activation: manual");
      assert.notInclude(text, "Step 1");
      assert.notInclude(text, "Recipe");
    }
  });

  it("does not inject a hidden figure workflow around the retained helper", async function () {
    const paperContext: PaperContextRef = {
      ...paper(),
      title: "Figure Paper",
      mineruCacheDir: "/tmp/llm-for-zotero-mineru/12",
    };
    const messages = await buildAgentInitialMessages(
      {
        ...request(),
        userText: "Explain Figure 1.",
        selectedPaperContexts: [paperContext],
      },
      [],
      ["analyze-figures"],
    );
    const text = messages.map((message) => message.content).join("\n");

    assert.include(text, "/tmp/llm-for-zotero-mineru/12");
    assert.notInclude(text, "TURN RULE: This is a figure/table");
    assert.notInclude(text, "call `paper_read({ mode:'figures'");
  });

  it("describes figure image support generically without naming specific models", function () {
    const text = readSkill("../src/agent/skills/analyze-figures.md");

    assert.include(text, "available PDF/image tools");
    for (const modelName of ["GPT-4o", "Codex", "Claude", "Gemini"]) {
      assert.notInclude(text, modelName);
    }
  });
});
