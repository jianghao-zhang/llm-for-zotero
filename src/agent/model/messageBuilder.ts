import type {
  AgentContentInputCapabilities,
  AgentModelMessage,
  AgentRuntimeRequest,
  AgentToolDefinition,
} from "../types";
import { AGENT_PERSONA_INSTRUCTIONS } from "./agentPersona";
import { buildAgentMemoryBlock } from "../store/conversationMemory";
import { getAllSkills } from "../skills";
import type { AgentSkill } from "../skills";

import { resolveProviderCapabilities } from "../../providers";
import type { ProviderCapabilities } from "../../providers";
import { buildNotesDirectoryConfigSection } from "../../utils/notesDirectoryConfig";
import { NOTE_EDITING_QUOTE_BLOCK_GUIDANCE } from "../../shared/quoteGuidance";
import { buildRuntimePlatformGuidanceText } from "../../utils/runtimePlatform";
import { formatPaperSourceLabel } from "../../modules/contextPanel/paperAttribution";
import {
  buildQuoteAnchorPromptBlock,
  buildSelectedTextQuoteCitations,
} from "../../modules/contextPanel/quoteCitations";
import {
  buildAgentStableResourceContextBlock,
  type AgentResourceContextPlan,
} from "../context/resourceContextPlan";
import { buildAgentCoverageContextBlock } from "../context/coverageLedger";
import { buildVisibleTurnContextBlock } from "../context/turnContextEnvelope";
import {
  hasAgentContentInputs,
  normalizeAgentContentInputs,
} from "./contentCapabilities";
import { detectExplicitFullReadIntent } from "../../modules/contextPanel/retrievalQueryPlan";
import { synthesizeSelectedTextContexts } from "../../modules/contextPanel/normalizers";
import {
  formatSelectedTextLocator,
  renderSelectedTextAnchorContext,
} from "../../modules/contextPanel/selectedTextAnchorFormatting";

export function isMultimodalRequestSupported(
  request: AgentRuntimeRequest,
): boolean {
  return hasAgentContentInputs(resolveRequestContentInputs(request));
}

function resolveRequestProviderCapabilities(
  request: AgentRuntimeRequest,
): ProviderCapabilities {
  return resolveProviderCapabilities({
    model: request.model || "",
    protocol: request.providerProtocol,
    authMode: request.authMode,
    apiBase: request.apiBase,
    inputMode: request.advanced?.inputMode,
  });
}

export function resolveRequestContentInputs(
  request: AgentRuntimeRequest,
): AgentContentInputCapabilities {
  const capabilities = resolveRequestProviderCapabilities(request);
  return {
    images: capabilities.images,
    pdfDocuments: capabilities.pdf === "native",
    nativeFiles:
      capabilities.tier === "native" &&
      request.providerProtocol === "responses_api" &&
      capabilities.pdf === "native",
  };
}

export function stringifyMessageContent(
  content: AgentModelMessage["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : part.type === "image_url"
          ? "[image]"
          : "[file]",
    )
    .join("\n");
}

/**
 * Keeps the first Q&A pair (for topic continuity) plus the most recent turns.
 * This prevents important first-turn context from being silently dropped when
 * the conversation grows long, while still respecting the total cap.
 */
function selectAgentHistoryWindow(
  history: import("../../utils/llmClient").ChatMessage[],
  maxTotal = 10,
): import("../../utils/llmClient").ChatMessage[] {
  if (history.length <= maxTotal) return history;
  // First pair anchors the conversation topic.
  const firstPair = history.slice(0, 2);
  const tail = history.slice(-(maxTotal - 2));
  // Avoid duplicating the first pair if history is very short.
  const tailStartIndex = history.length - (maxTotal - 2);
  if (tailStartIndex <= 2) return history.slice(-maxTotal);
  return [...firstPair, ...tail];
}

export function normalizeHistoryMessages(
  request: AgentRuntimeRequest,
): AgentModelMessage[] {
  const raw = Array.isArray(request.history) ? request.history : [];
  const windowed = selectAgentHistoryWindow(raw, 10);
  return windowed
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: stringifyMessageContent(message.content),
    }));
}

function buildFullUserMessage(
  request: AgentRuntimeRequest,
  options: {
    priorReadBlock?: string;
    coverageBlock?: string;
    memoryBlock?: string;
    turnGuidanceBlock?: string;
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): AgentModelMessage {
  const contextLines: string[] = [];
  const visibleTurnContext = buildVisibleTurnContextBlock(request);
  if (visibleTurnContext) {
    contextLines.push(visibleTurnContext);
  }
  if (request.activeNoteContext) {
    const note = request.activeNoteContext;
    contextLines.push(
      `Current note content for this turn:\n"""\n${note.noteText}\n"""`,
    );
    contextLines.push(NOTE_EDITING_QUOTE_BLOCK_GUIDANCE);
    if (note.noteHtml) {
      contextLines.push(`Original note HTML:\n"""\n${note.noteHtml}\n"""`);
    }
  }
  const selectedTextContexts = synthesizeSelectedTextContexts({
    selectedTextContexts: request.selectedTextContexts,
    selectedTexts: request.selectedTexts,
    selectedTextSources: request.selectedTextSources,
    selectedTextPaperContexts: request.selectedTextPaperContexts,
    selectedTextNoteContexts: request.selectedTextNoteContexts,
  });
  const selectedTexts = selectedTextContexts.map((context) => context.text);
  const selectedTextSources = selectedTextContexts.map(
    (context) => context.source,
  );
  const selectedTextPaperContexts = selectedTextContexts.map(
    (context) => context.paperContext,
  );
  const anchorsByIndex = new Map(
    (request.resolvedSelectedTextAnchors || []).map((anchor) => [
      anchor.contextIndex,
      anchor,
    ]),
  );
  if (selectedTexts.length) {
    const selectedTextQuoteAnchors = buildQuoteAnchorPromptBlock(
      buildSelectedTextQuoteCitations(
        selectedTexts,
        selectedTextSources,
        selectedTextPaperContexts,
      ),
    );
    const selectedTextBlock = selectedTexts
      .map((entry, index) => {
        const source = selectedTextSources[index];
        const paperContext = selectedTextPaperContexts[index];
        const sourceLabel =
          source === "model"
            ? "model response"
            : source === "note"
              ? "Zotero note"
              : source === "note-edit"
                ? "active note editing focus"
                : "PDF reader";
        const noteContext = selectedTextContexts[index]?.noteContext;
        const sourceMeta =
          source === "pdf" && paperContext
            ? `, paper=${paperContext.title}, source_label=${formatPaperSourceLabel(paperContext)}`
            : source === "note-edit" && noteContext
              ? [
                  `, note=${noteContext.title}`,
                  noteContext.noteItemId
                    ? `note_id=${noteContext.noteItemId}`
                    : "",
                  `note_kind=${noteContext.noteKind}`,
                  noteContext.parentItemId
                    ? `parent_item_id=${noteContext.parentItemId}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(", ")
              : "";
        const locator = formatSelectedTextLocator(
          selectedTextContexts[index],
          anchorsByIndex.get(index),
        );
        return `Selected text ${index + 1} [source=${sourceLabel}${sourceMeta}]${locator ? ` ${locator}` : ""}:\n"""\n${entry}\n"""`;
      })
      .join("\n\n");
    contextLines.push(
      [...selectedTextQuoteAnchors, selectedTextBlock]
        .filter(Boolean)
        .join("\n\n"),
    );
    const anchorContext = renderSelectedTextAnchorContext({
      selectedTextContexts,
      anchors: request.resolvedSelectedTextAnchors || [],
    });
    if (anchorContext) contextLines.push(anchorContext);
  }
  const pdfAttachments = (request.attachments || []).filter(
    (a) =>
      a.category === "pdf" &&
      typeof a.storedPath === "string" &&
      a.storedPath.trim(),
  );
  const nonPdfAttachments = (request.attachments || []).filter(
    (a) => a.category !== "pdf",
  );
  if (nonPdfAttachments.length) {
    contextLines.push(
      "Current uploaded attachments are available through the registered document tools.",
    );
  }
  if (options.priorReadBlock) {
    contextLines.push(options.priorReadBlock);
  }
  if (options.coverageBlock) {
    contextLines.push(options.coverageBlock);
  }
  if (options.memoryBlock) {
    contextLines.push(options.memoryBlock);
  }
  if (options.turnGuidanceBlock) {
    contextLines.push(options.turnGuidanceBlock);
  }

  const promptText = `${
    contextLines.length ? `${contextLines.join("\n")}\n\n` : ""
  }User request:\n${request.userText}`;
  const screenshots = Array.isArray(request.screenshots)
    ? request.screenshots.filter((entry) => Boolean(entry))
    : [];
  const contentInputs = normalizeAgentContentInputs(
    options.contentInputs || resolveRequestContentInputs(request),
  );
  const imageParts = contentInputs.images
    ? screenshots.map((url) => ({
        type: "image_url" as const,
        image_url: {
          url,
          detail: "high" as const,
        },
      }))
    : [];
  const pdfParts =
    contentInputs.pdfDocuments || contentInputs.nativeFiles
      ? pdfAttachments.map((a) => ({
          type: "file_ref" as const,
          file_ref: {
            name: a.name,
            mimeType: a.mimeType || "application/pdf",
            storedPath: a.storedPath as string,
            contentHash: a.contentHash,
          },
        }))
      : [];
  if (!imageParts.length && !pdfParts.length) {
    return {
      role: "user",
      content: promptText,
    };
  }
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: promptText,
      },
      ...imageParts,
      ...pdfParts,
    ],
  };
}

function buildUserMessage(
  request: AgentRuntimeRequest,
  resourceContextPlan?: AgentResourceContextPlan,
  options: {
    coverageBlock?: string;
    memoryBlock?: string;
    turnGuidanceBlock?: string;
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): AgentModelMessage {
  return buildFullUserMessage(request, {
    priorReadBlock: resourceContextPlan?.priorReadBlock,
    coverageBlock: options.coverageBlock,
    memoryBlock: options.memoryBlock,
    turnGuidanceBlock: options.turnGuidanceBlock,
    contentInputs: options.contentInputs,
  });
}

type PromptSection = {
  /** Identifies the section in code; not emitted into the prompt text */
  id: string;
  lines: string[];
};

function buildSystemPrompt(sections: PromptSection[]): string {
  return sections
    .flatMap(({ lines }) => lines)
    .filter(Boolean)
    .join("\n\n");
}

function collectToolGuidanceInstructions(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
): string[] {
  const instructions = new Set<string>();
  for (const tool of tools) {
    const guidance = tool.guidance;
    if (!guidance) continue;
    if (!guidance.matches(request)) continue;
    const instruction = guidance.instruction.trim();
    if (instruction) instructions.add(instruction);
  }

  if (!instructions.size) return [];
  return [
    "The following stable tool guidance is provided because the user's message may be relevant to these capabilities. " +
      "Use your judgement: only invoke a tool if it directly addresses what the user is asking for. " +
      "Do NOT invoke a tool just because its guidance appears here — the user's actual intent takes priority.",
    ...instructions,
  ];
}

function formatSkillGuidanceBlock(
  skill: AgentSkill,
  activationSource: string,
): string {
  const lines = [
    `### Skill: ${skill.id}`,
    `Description: ${skill.description || "No description provided."}`,
    `Activation: ${activationSource}`,
    "Instructions:",
    skill.instruction.trim(),
  ];
  return lines.filter(Boolean).join("\n");
}

function collectSkillGuidanceInstructions(
  request: AgentRuntimeRequest,
  matchedSkillIds: ReadonlyArray<string>,
): string[] {
  const blocks: string[] = [];
  const activeSkillIds = new Set(matchedSkillIds);
  const forcedSkillIds = new Set(request.forcedSkillIds || []);
  for (const skill of getAllSkills()) {
    if (!activeSkillIds.has(skill.id)) continue;
    const instruction = skill.instruction.trim();
    if (!instruction) continue;
    blocks.push(
      formatSkillGuidanceBlock(
        skill,
        forcedSkillIds.has(skill.id)
          ? "explicit slash selection"
          : "automatic match",
      ),
    );
  }
  if (!blocks.length) return [];
  return [
    "Active skills for this turn:",
    "Treat each skill below as a separate workflow module. If multiple skills are active, first decide which part of the user's request each skill covers. Prefer explicitly selected slash skills when they are relevant. If skill instructions conflict, follow the user's explicit request and the available tool/safety constraints.",
    ...blocks,
  ];
}

function buildTurnGuidanceBlock(instructions: string[]): string {
  const lines = instructions.map((entry) => entry.trim()).filter(Boolean);
  if (!lines.length) return "";
  return ["Current-turn dynamic agent guidance:", ...lines].join("\n\n");
}

function buildAutoReadInstruction(request: AgentRuntimeRequest): string {
  const fullTextPapers = request.fullTextPaperContexts || [];
  if (!fullTextPapers.length) return "";
  if (detectExplicitFullReadIntent(request.userText || "")) {
    return (
      "TURN RULE: The user explicitly requested exhaustive full-text reading. " +
      "Your very first action MUST be to call `paper_read({ mode:'full' })` targeting only the requested paper(s). " +
      "Overview and targeted retrieval do not satisfy this request. Preserve the coverage receipt and do not claim complete reading when it is partial or unreadable."
    );
  }
  const allHaveMineruCache = fullTextPapers.every((entry) =>
    Boolean(entry.mineruCacheDir),
  );
  if (allHaveMineruCache) {
    return (
      "TURN RULE: Because the user marked specific paper(s) for full-text use on this turn, " +
      "your very first action MUST be to call `paper_read({ mode:'overview' })` targeting only those full-text papers. " +
      "The paper_read facade dispatches to the available MinerU or PDF text path; use `paper_read({ mode:'targeted', query:'...' })` only for a specific missing claim. " +
      "Do this before answering, even if the answer seems obvious."
    );
  }
  return (
    "TURN RULE: Because the user marked specific paper(s) for full-text use on this turn, " +
    "your very first action MUST be to call `paper_read({ mode:'overview' })` targeting only those full-text papers. " +
    "Do this before answering, even if the answer seems obvious. " +
    "Do not include retrieval-only papers in that mandatory first read."
  );
}

function buildRuntimePlatformSection(): string {
  return buildRuntimePlatformGuidanceText();
}

function buildTextOnlyModelInstruction(request: AgentRuntimeRequest): string {
  if (isMultimodalRequestSupported(request)) return "";
  const modelLabel = (request.model || "selected model").trim();
  return (
    `MODEL LIMITATION: ${modelLabel} is treated as text-only in this plugin. ` +
    "Do not rely on screenshots, PDF page images, or image-file visual inspection. " +
    "For MinerU-cached papers, prefer `manifest.json`, `full.md` section offsets, captions, tables, formulas, and surrounding extracted text. " +
    "For figure workflows, you may still call `paper_read({ mode:'figures' })` to obtain extracted crop paths, captions, warnings, and provenance for note embedding. Treat that result as the authority for figure crop cache reuse/regeneration; do not inspect or validate `figure_crops` metadata before analysis or writing. Do not make unsupported visual claims unless an image-capable model inspected the crop."
  );
}

export async function buildAgentInitialMessages(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
  matchedSkillIds: ReadonlyArray<string>,
  resourceContextPlan?: AgentResourceContextPlan,
  options: {
    transcriptMessages?: AgentModelMessage[];
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): Promise<AgentModelMessage[]> {
  const memoryBlock = await buildAgentMemoryBlock(request.conversationKey);
  const autoReadInstruction = buildAutoReadInstruction(request);
  const turnGuidanceBlock = buildTurnGuidanceBlock([
    autoReadInstruction,
    ...collectToolGuidanceInstructions(request, tools),
    ...collectSkillGuidanceInstructions(request, matchedSkillIds),
  ]);
  const coverageBlock = buildAgentCoverageContextBlock({
    conversationKey: request.conversationKey,
    request,
  });

  const sections: PromptSection[] = [
    {
      id: "system-override",
      lines: [(request.systemPrompt || "").trim()],
    },
    {
      id: "persona",
      lines: AGENT_PERSONA_INSTRUCTIONS,
    },
    {
      id: "runtime-platform",
      lines: [buildRuntimePlatformSection()],
    },
    {
      id: "model-limitations",
      lines: [buildTextOnlyModelInstruction(request)],
    },
    {
      id: "custom-instructions",
      lines: [(request.customInstructions || "").trim()],
    },
    {
      id: "notes-directory-config",
      lines: [buildNotesDirectoryConfigSection()],
    },
  ];
  const stableResourceBlock =
    resourceContextPlan?.stableContextBlock ||
    buildAgentStableResourceContextBlock(request);

  return [
    {
      role: "system",
      content: buildSystemPrompt(sections),
    },
    ...(stableResourceBlock
      ? [
          {
            role: "system" as const,
            content: stableResourceBlock,
            cachePolicy: "stable-prefix" as const,
          },
        ]
      : []),
    ...(options.transcriptMessages?.length
      ? options.transcriptMessages
      : normalizeHistoryMessages(request)),
    buildUserMessage(request, resourceContextPlan, {
      coverageBlock,
      memoryBlock,
      turnGuidanceBlock,
      contentInputs: options.contentInputs,
    }),
  ];
}
