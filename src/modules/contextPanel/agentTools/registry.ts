import type {
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolName,
  ResolvedAgentToolTarget,
} from "./types";
import {
  executeFindClaimEvidenceCall,
  validateFindClaimEvidenceCall,
} from "./tools/findClaimEvidence";
import {
  executeReadPaperTextCall,
  validateReadPaperTextCall,
} from "./tools/readPaperText";
import {
  executeReadReferencesCall,
  validateReadReferencesCall,
} from "./tools/readReferences";
import { validateListPapersCall } from "./tools/listPapers";
import { validateSearchInternetCall } from "./tools/searchInternet";
import {
  executeGetPaperSectionsCall,
  validateGetPaperSectionsCall,
} from "./tools/getPaperSections";
import {
  executeSearchPaperContentCall,
  validateSearchPaperContentCall,
} from "./tools/searchPaperContent";
import {
  executeWriteNoteCall,
  validateWriteNoteCall,
} from "./tools/writeNote";

export type AgentToolDefinition = {
  name: AgentToolName;
  plannerDescription: string;
  /** One-line JSON example of the call format, shown to the model. */
  callExample: string;
  validate(call: AgentToolCall): AgentToolCall | null;
  /**
   * execute is only defined for paper tools (read_paper_text, find_claim_evidence,
   * read_references).  list_papers is executed directly by the executor.
   */
  execute?(
    ctx: AgentToolExecutionContext,
    call: AgentToolCall,
    target: ResolvedAgentToolTarget,
  ): Promise<AgentToolExecutionResult>;
};

const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "list_papers",
    plannerDescription:
      "list or search the active Zotero library; returns a metadata overview and loads results as retrieved-paper#N targets for subsequent tool calls",
    callExample: '{"name":"list_papers","query":"optional search terms","limit":6}',
    validate: validateListPapersCall,
  },
  {
    name: "read_paper_text",
    plannerDescription:
      "read the full body text of one specific paper; expensive — use only when complete paper text is necessary",
    callExample: '{"name":"read_paper_text","target":{"scope":"retrieved-paper","index":1}}',
    validate: validateReadPaperTextCall,
    execute: executeReadPaperTextCall,
  },
  {
    name: "find_claim_evidence",
    plannerDescription:
      "retrieve the most relevant evidence snippets from one paper for the user question; cheaper and more focused than reading the full text",
    callExample: '{"name":"find_claim_evidence","target":{"scope":"active-paper"}}',
    validate: validateFindClaimEvidenceCall,
    execute: executeFindClaimEvidenceCall,
  },
  {
    name: "read_references",
    plannerDescription:
      "extract the references or bibliography section of one paper when the user asks what the paper cites",
    callExample: '{"name":"read_references","target":{"scope":"selected-paper","index":1}}',
    validate: validateReadReferencesCall,
    execute: executeReadReferencesCall,
  },
  {
    name: "get_paper_sections",
    plannerDescription:
      "list the sections and structure of one paper; useful for understanding layout before targeted retrieval",
    callExample: '{"name":"get_paper_sections","target":{"scope":"active-paper"}}',
    validate: validateGetPaperSectionsCall,
    execute: executeGetPaperSectionsCall,
  },
  {
    name: "search_paper_content",
    plannerDescription:
      "keyword search inside one paper's full text; use when you need to find all passages mentioning a specific term or phrase",
    callExample: '{"name":"search_paper_content","target":{"scope":"active-paper"},"query":"keyword or phrase"}',
    validate: validateSearchPaperContentCall,
    execute: executeSearchPaperContentCall,
  },
  {
    name: "search_internet",
    plannerDescription:
      "search Semantic Scholar for academic papers on the internet; use when the user asks about papers not in their Zotero library or wants to find related work",
    callExample: '{"name":"search_internet","query":"neural plasticity memory","limit":6}',
    validate: validateSearchInternetCall,
  },
  {
    name: "write_note",
    plannerDescription:
      "generate and save a structured reading note for one paper to Zotero; use the query field to specify what the note should contain (extracted from the user's request)",
    callExample: '{"name":"write_note","target":{"scope":"active-paper"},"query":"one sentence key point"}',
    validate: validateWriteNoteCall,
    execute: executeWriteNoteCall,
  },
];

export function getAgentToolDefinitions(): readonly AgentToolDefinition[] {
  return AGENT_TOOL_DEFINITIONS;
}

export function getAgentToolDefinition(
  name: AgentToolName,
): AgentToolDefinition | null {
  return AGENT_TOOL_DEFINITIONS.find((definition) => definition.name === name) || null;
}
