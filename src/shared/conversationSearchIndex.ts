import type { ConversationSystem } from "./types";
import {
  repairRecoverableCatalogMessageConversationIDs,
} from "./conversationMessageIdentityRepair";
import type { PaperContextJsonColumns } from "./conversationRegistry";

type ZoteroDb = {
  queryAsync?: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export const CONVERSATION_SEARCH_INDEX_TABLE =
  "llm_for_zotero_conversation_search_index";

export const CONVERSATION_SEARCH_BODY_CHAR_LIMIT = 200_000;

const SEARCH_INDEX_LIBRARY_INDEX =
  "llm_for_zotero_conversation_search_index_library_idx";

const MESSAGE_JOIN_CONDITION =
  "(m.conversation_id = c.conversation_id OR ((m.conversation_id IS NULL OR TRIM(m.conversation_id) = '') AND m.conversation_key = c.conversation_key))";

const FIRST_USER_MESSAGE_SQL = `(SELECT m0.text
  FROM {messageTable} m0
  WHERE (m0.conversation_id = c.conversation_id OR ((m0.conversation_id IS NULL OR TRIM(m0.conversation_id) = '') AND m0.conversation_key = c.conversation_key))
    AND m0.role = 'user'
  ORDER BY m0.timestamp ASC, m0.id ASC
  LIMIT 1)`;

export type ConversationSearchIndexMatch = {
  conversationID: string;
  conversationKey: number;
  system: ConversationSystem;
  kind: "global" | "paper";
  libraryID: number;
  paperItemID?: number;
  title: string;
  bodyText: string;
  lastActivityAt: number;
  userTurnCount: number;
};

export type ConversationSearchIndexStatus =
  | "ready"
  | "empty"
  | "stale"
  | "truncated"
  | "unavailable";

export type ConversationSearchIndexResult = {
  matches: ConversationSearchIndexMatch[];
  status: ConversationSearchIndexStatus;
  indexedRowCount: number;
  catalogRowCount: number;
  truncatedRowCount: number;
};

function getZoteroDb(): ZoteroDb | null {
  return (
    (globalThis as typeof globalThis & { Zotero?: { DB?: ZoteroDb } }).Zotero
      ?.DB || null
  );
}

function normalizePositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function normalizeText(value: unknown, maxLength = 2_000_000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSystem(value: unknown): ConversationSystem | null {
  return value === "upstream" || value === "claude_code" || value === "codex"
    ? value
    : null;
}

function normalizeKind(value: unknown): "global" | "paper" | null {
  return value === "global" || value === "paper" ? value : null;
}

function normalizeOptionalLimit(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function normalizeSearchQuery(value: unknown): string {
  return normalizeText(value, 512)
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function tokenizeSearchQuery(value: unknown): string[] {
  const normalized = normalizeSearchQuery(value);
  if (!normalized) return [];
  return Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  );
}

function escapeLikeToken(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function tableExists(db: ZoteroDb, tableName: string): Promise<boolean> {
  const rows = (await db.queryAsync?.(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name = ?
     LIMIT 1`,
    [tableName],
  )) as Array<{ name?: unknown }> | undefined;
  return Boolean(rows?.length);
}

export async function initConversationSearchIndexStore(): Promise<boolean> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  await db.queryAsync(
    `CREATE TABLE IF NOT EXISTS ${CONVERSATION_SEARCH_INDEX_TABLE} (
      conversation_id TEXT PRIMARY KEY,
      legacy_conversation_key INTEGER NOT NULL,
      system TEXT NOT NULL CHECK(system IN ('upstream', 'claude_code', 'codex')),
      kind TEXT NOT NULL CHECK(kind IN ('global', 'paper')),
      library_id INTEGER NOT NULL,
      paper_item_id INTEGER,
      title TEXT,
      body_text TEXT NOT NULL,
      last_activity_at INTEGER NOT NULL,
      user_turn_count INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    )`,
  );
  await db.queryAsync(
    `CREATE INDEX IF NOT EXISTS ${SEARCH_INDEX_LIBRARY_INDEX}
     ON ${CONVERSATION_SEARCH_INDEX_TABLE}
       (system, library_id, user_turn_count, last_activity_at DESC)`,
  );
  return true;
}

async function refreshCatalogIntoSearchIndex(params: {
  system: ConversationSystem;
  catalogTable: string;
  messageTable: string;
  kindSql: string;
  paperItemIDSql: string;
  activitySql: string;
  groupBySql: string;
  filterSql?: string;
  filterParams?: unknown[];
}): Promise<void> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return;
  if (
    !(await tableExists(db, params.catalogTable)) ||
    !(await tableExists(db, params.messageTable))
  ) {
    return;
  }
  await repairRecoverableCatalogMessageConversationIDs({
    queryAsync: db.queryAsync.bind(db),
    catalogTable: params.catalogTable,
    messageTable: params.messageTable,
    system: params.system,
    kindSql: params.kindSql,
    paperItemIDSql: params.paperItemIDSql,
    filterSql: params.filterSql,
    filterParams: params.filterParams,
    getPaperContextRows: (conversationKey) =>
      getMessagePaperContextRows(params.messageTable, conversationKey),
    storeLabel: `${params.system} search index`,
  });
  const firstUserMessageSql = FIRST_USER_MESSAGE_SQL.replace(
    /\{messageTable\}/g,
    params.messageTable,
  );
  await db.queryAsync(
    `INSERT OR REPLACE INTO ${CONVERSATION_SEARCH_INDEX_TABLE}
      (conversation_id, legacy_conversation_key, system, kind, library_id, paper_item_id, title, body_text, last_activity_at, user_turn_count, indexed_at)
     SELECT c.conversation_id,
            c.conversation_key,
            ?,
            ${params.kindSql},
            c.library_id,
            ${params.paperItemIDSql},
            COALESCE(NULLIF(TRIM(c.title), ''), ${firstUserMessageSql}, ''),
            SUBSTR(COALESCE(GROUP_CONCAT(SUBSTR(m.text, 1, ?), char(10)), ''), 1, ?),
            ${params.activitySql},
            COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0),
            ?
     FROM ${params.catalogTable} c
     LEFT JOIN ${params.messageTable} m
       ON ${MESSAGE_JOIN_CONDITION}
     WHERE c.conversation_id IS NOT NULL
       AND TRIM(c.conversation_id) <> ''
       ${params.filterSql ? `AND (${params.filterSql})` : ""}
     GROUP BY ${params.groupBySql}`,
    [
      params.system,
      CONVERSATION_SEARCH_BODY_CHAR_LIMIT,
      CONVERSATION_SEARCH_BODY_CHAR_LIMIT,
      Date.now(),
      ...(params.filterParams || []),
    ],
  );
}

async function getMessagePaperContextRows(
  messageTable: string,
  conversationKey: number,
): Promise<PaperContextJsonColumns[]> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return [];
  return ((await db.queryAsync(
    `SELECT paper_contexts_json AS paperContextsJson,
            full_text_paper_contexts_json AS fullTextPaperContextsJson,
            selected_text_paper_contexts_json AS selectedTextPaperContextsJson,
            citation_paper_contexts_json AS citationPaperContextsJson
     FROM ${messageTable}
     WHERE conversation_key = ?
       AND (
         paper_contexts_json IS NOT NULL OR
         full_text_paper_contexts_json IS NOT NULL OR
         selected_text_paper_contexts_json IS NOT NULL OR
         citation_paper_contexts_json IS NOT NULL
       )`,
    [conversationKey],
  )) || []) as PaperContextJsonColumns[];
}

function buildCatalogConversationFilter(params: {
  conversationID?: string;
  conversationKey?: number;
}): { filterSql?: string; filterParams?: unknown[] } {
  const conversationID =
    typeof params.conversationID === "string"
      ? normalizeText(params.conversationID, 512)
      : "";
  if (conversationID) {
    return { filterSql: "c.conversation_id = ?", filterParams: [conversationID] };
  }
  const conversationKey = normalizePositiveInt(params.conversationKey);
  if (conversationKey) {
    return { filterSql: "c.conversation_key = ?", filterParams: [conversationKey] };
  }
  return {};
}

async function pruneStaleSearchRows(params: {
  system: ConversationSystem;
  catalogTables: string[];
}): Promise<void> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return;
  const existingCatalogs: string[] = [];
  for (const tableName of params.catalogTables) {
    if (await tableExists(db, tableName)) {
      existingCatalogs.push(tableName);
    }
  }
  if (!existingCatalogs.length) return;
  const keepSql = existingCatalogs
    .map(
      (tableName) =>
        `SELECT conversation_id FROM ${tableName} WHERE conversation_id IS NOT NULL AND TRIM(conversation_id) <> ''`,
    )
    .join("\nUNION\n");
  await db.queryAsync(
    `DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
     WHERE system = ?
       AND conversation_id NOT IN (${keepSql})`,
    [params.system],
  );
}

export async function refreshConversationSearchIndexForSystem(
  system: ConversationSystem,
): Promise<boolean> {
  const initialized = await initConversationSearchIndexStore();
  if (!initialized) return false;
  if (system === "upstream") {
    await refreshCatalogIntoSearchIndex({
      system,
      catalogTable: "llm_for_zotero_global_conversations",
      messageTable: "llm_for_zotero_chat_messages",
      kindSql: "'global'",
      paperItemIDSql: "NULL",
      activitySql: "COALESCE(MAX(m.timestamp), c.created_at)",
      groupBySql: "c.conversation_id, c.conversation_key, c.library_id, c.created_at, c.title",
    });
    await refreshCatalogIntoSearchIndex({
      system,
      catalogTable: "llm_for_zotero_paper_conversations",
      messageTable: "llm_for_zotero_chat_messages",
      kindSql: "'paper'",
      paperItemIDSql: "c.paper_item_id",
      activitySql: "COALESCE(MAX(m.timestamp), c.created_at)",
      groupBySql:
        "c.conversation_id, c.conversation_key, c.library_id, c.paper_item_id, c.created_at, c.title",
    });
    await pruneStaleSearchRows({
      system,
      catalogTables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
      ],
    });
    return true;
  }
  const catalogTable =
    system === "claude_code"
      ? "llm_for_zotero_claude_conversations"
      : "llm_for_zotero_codex_conversations";
  const messageTable =
    system === "claude_code"
      ? "llm_for_zotero_claude_messages"
      : "llm_for_zotero_codex_messages";
  await refreshCatalogIntoSearchIndex({
    system,
    catalogTable,
    messageTable,
    kindSql: "c.kind",
    paperItemIDSql: "c.paper_item_id",
    activitySql: "COALESCE(MAX(m.timestamp), c.updated_at, c.created_at)",
    groupBySql:
      "c.conversation_id, c.conversation_key, c.library_id, c.kind, c.paper_item_id, c.created_at, c.updated_at, c.title",
  });
  await pruneStaleSearchRows({ system, catalogTables: [catalogTable] });
  return true;
}

export async function refreshConversationSearchIndexForConversation(params: {
  system: ConversationSystem;
  conversationID?: string;
  conversationKey?: number;
}): Promise<boolean> {
  const system = normalizeSystem(params.system);
  if (!system) return false;
  const filter = buildCatalogConversationFilter(params);
  if (!filter.filterSql) return false;
  const initialized = await initConversationSearchIndexStore();
  if (!initialized) return false;
  if (system === "upstream") {
    await refreshCatalogIntoSearchIndex({
      system,
      catalogTable: "llm_for_zotero_global_conversations",
      messageTable: "llm_for_zotero_chat_messages",
      kindSql: "'global'",
      paperItemIDSql: "NULL",
      activitySql: "COALESCE(MAX(m.timestamp), c.created_at)",
      groupBySql: "c.conversation_id, c.conversation_key, c.library_id, c.created_at, c.title",
      ...filter,
    });
    await refreshCatalogIntoSearchIndex({
      system,
      catalogTable: "llm_for_zotero_paper_conversations",
      messageTable: "llm_for_zotero_chat_messages",
      kindSql: "'paper'",
      paperItemIDSql: "c.paper_item_id",
      activitySql: "COALESCE(MAX(m.timestamp), c.created_at)",
      groupBySql:
        "c.conversation_id, c.conversation_key, c.library_id, c.paper_item_id, c.created_at, c.title",
      ...filter,
    });
    return true;
  }
  const catalogTable =
    system === "claude_code"
      ? "llm_for_zotero_claude_conversations"
      : "llm_for_zotero_codex_conversations";
  const messageTable =
    system === "claude_code"
      ? "llm_for_zotero_claude_messages"
      : "llm_for_zotero_codex_messages";
  await refreshCatalogIntoSearchIndex({
    system,
    catalogTable,
    messageTable,
    kindSql: "c.kind",
    paperItemIDSql: "c.paper_item_id",
    activitySql: "COALESCE(MAX(m.timestamp), c.updated_at, c.created_at)",
    groupBySql:
      "c.conversation_id, c.conversation_key, c.library_id, c.kind, c.paper_item_id, c.created_at, c.updated_at, c.title",
    ...filter,
  });
  return true;
}

export async function deleteConversationSearchIndexRow(params: {
  conversationID?: string;
  system?: ConversationSystem;
  conversationKey?: number;
}): Promise<boolean> {
  const initialized = await initConversationSearchIndexStore();
  if (!initialized) return false;
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  const conversationID =
    typeof params.conversationID === "string"
      ? normalizeText(params.conversationID, 512)
      : "";
  if (conversationID) {
    await db.queryAsync(
      `DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
       WHERE conversation_id = ?`,
      [conversationID],
    );
    return true;
  }
  const system = normalizeSystem(params.system);
  const conversationKey = normalizePositiveInt(params.conversationKey);
  if (!conversationKey) return false;
  if (system) {
    await db.queryAsync(
      `DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
       WHERE system = ?
         AND legacy_conversation_key = ?`,
      [system, conversationKey],
    );
    return true;
  }
  await db.queryAsync(
    `DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
     WHERE legacy_conversation_key = ?`,
    [conversationKey],
  );
  return true;
}

export async function refreshConversationSearchIndex(): Promise<boolean> {
  const initialized = await initConversationSearchIndexStore();
  if (!initialized) return false;
  await refreshConversationSearchIndexForSystem("upstream");
  await refreshConversationSearchIndexForSystem("claude_code");
  await refreshConversationSearchIndexForSystem("codex");
  return true;
}

async function getIndexedSearchCoverage(params: {
  system: ConversationSystem;
  libraryID: number;
}): Promise<{
  indexedRowCount: number;
  catalogRowCount: number;
  missingIndexedRowCount: number;
  truncatedRowCount: number;
}> {
  const db = getZoteroDb();
  if (!db?.queryAsync) {
    return {
      indexedRowCount: 0,
      catalogRowCount: 0,
      missingIndexedRowCount: 0,
      truncatedRowCount: 0,
    };
  }
  const indexedRows = (await db.queryAsync(
    `SELECT COUNT(*) AS indexedRowCount,
            SUM(CASE WHEN LENGTH(COALESCE(body_text, '')) >= ? THEN 1 ELSE 0 END) AS truncatedRowCount
     FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
     WHERE system = ?
       AND library_id = ?
       AND user_turn_count > 0`,
    [CONVERSATION_SEARCH_BODY_CHAR_LIMIT, params.system, params.libraryID],
  )) as Array<{
    indexedRowCount?: unknown;
    truncatedRowCount?: unknown;
  }> | undefined;
  const indexedRowCount = normalizePositiveInt(
    indexedRows?.[0]?.indexedRowCount,
  );
  const truncatedRowCount = normalizePositiveInt(
    indexedRows?.[0]?.truncatedRowCount,
  );

  const catalogTables =
    params.system === "upstream"
      ? [
          "llm_for_zotero_global_conversations",
          "llm_for_zotero_paper_conversations",
        ]
      : [
          params.system === "claude_code"
            ? "llm_for_zotero_claude_conversations"
            : "llm_for_zotero_codex_conversations",
        ];
  const existingCatalogs: string[] = [];
  for (const tableName of catalogTables) {
    if (await tableExists(db, tableName)) existingCatalogs.push(tableName);
  }
  if (!existingCatalogs.length) {
    return {
      indexedRowCount,
      catalogRowCount: 0,
      missingIndexedRowCount: 0,
      truncatedRowCount,
    };
  }
  const catalogUnion = existingCatalogs
    .map(
      (tableName) =>
        `SELECT conversation_id
         FROM ${tableName}
         WHERE library_id = ?
           AND conversation_id IS NOT NULL
           AND TRIM(conversation_id) <> ''
           AND COALESCE(user_turn_count, 0) > 0`,
    )
    .join("\nUNION ALL\n");
  const catalogParams = existingCatalogs.map(() => params.libraryID);
  const catalogRows = (await db.queryAsync(
    `SELECT COUNT(*) AS catalogRowCount,
            SUM(CASE WHEN si.conversation_id IS NULL THEN 1 ELSE 0 END) AS missingIndexedRowCount
     FROM (${catalogUnion}) c
     LEFT JOIN ${CONVERSATION_SEARCH_INDEX_TABLE} si
       ON si.conversation_id = c.conversation_id
      AND si.system = ?`,
    [...catalogParams, params.system],
  )) as Array<{
    catalogRowCount?: unknown;
    missingIndexedRowCount?: unknown;
  }> | undefined;
  return {
    indexedRowCount,
    catalogRowCount: normalizePositiveInt(catalogRows?.[0]?.catalogRowCount),
    missingIndexedRowCount: normalizePositiveInt(
      catalogRows?.[0]?.missingIndexedRowCount,
    ),
    truncatedRowCount,
  };
}

function normalizeMatch(row: Record<string, unknown>): ConversationSearchIndexMatch | null {
  const conversationID = normalizeText(row.conversationID, 512);
  const conversationKey = normalizePositiveInt(row.conversationKey);
  const system = normalizeSystem(row.system);
  const kind = normalizeKind(row.kind);
  const libraryID = normalizePositiveInt(row.libraryID);
  const paperItemID = normalizePositiveInt(row.paperItemID);
  const lastActivityAt = Number(row.lastActivityAt);
  const userTurnCount = Number(row.userTurnCount);
  if (!conversationID || !conversationKey || !system || !kind || !libraryID) {
    return null;
  }
  if (kind === "paper" && !paperItemID) return null;
  return {
    conversationID,
    conversationKey,
    system,
    kind,
    libraryID,
    paperItemID: kind === "paper" ? paperItemID : undefined,
    title: normalizeText(row.title, 512),
    bodyText: normalizeText(row.bodyText),
    lastActivityAt: Number.isFinite(lastActivityAt)
      ? Math.max(0, Math.floor(lastActivityAt))
      : 0,
    userTurnCount: Number.isFinite(userTurnCount)
      ? Math.max(0, Math.floor(userTurnCount))
      : 0,
  };
}

export async function searchConversationIndex(params: {
  system: ConversationSystem;
  libraryID: number;
  query: string;
  limit?: number;
  refresh?: boolean;
}): Promise<ConversationSearchIndexMatch[]> {
  return (await searchConversationIndexWithStatus(params)).matches;
}

export async function searchConversationIndexWithStatus(params: {
  system: ConversationSystem;
  libraryID: number;
  query: string;
  limit?: number;
  refresh?: boolean;
}): Promise<ConversationSearchIndexResult> {
  const system = normalizeSystem(params.system);
  const libraryID = normalizePositiveInt(params.libraryID);
  const tokens = tokenizeSearchQuery(params.query);
  if (!system || !libraryID || !tokens.length) {
    return {
      matches: [],
      status: "unavailable",
      indexedRowCount: 0,
      catalogRowCount: 0,
      truncatedRowCount: 0,
    };
  }
  const initialized = await initConversationSearchIndexStore();
  if (!initialized) {
    return {
      matches: [],
      status: "unavailable",
      indexedRowCount: 0,
      catalogRowCount: 0,
      truncatedRowCount: 0,
    };
  }
  if (params.refresh === true) {
    await refreshConversationSearchIndexForSystem(system);
  }
  const db = getZoteroDb();
  if (!db?.queryAsync) {
    return {
      matches: [],
      status: "unavailable",
      indexedRowCount: 0,
      catalogRowCount: 0,
      truncatedRowCount: 0,
    };
  }
  const coverage = await getIndexedSearchCoverage({ system, libraryID });
  const tokenClauses: string[] = [];
  const queryParams: unknown[] = [system, libraryID];
  for (const token of tokens) {
    const pattern = `%${escapeLikeToken(token)}%`;
    tokenClauses.push(
      "(LOWER(COALESCE(title, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(body_text, '')) LIKE ? ESCAPE '\\' OR LOWER(CASE WHEN kind = 'global' THEN 'library chat' ELSE 'paper chat' END) LIKE ? ESCAPE '\\')",
    );
    queryParams.push(pattern, pattern, pattern);
  }
  const limit = normalizeOptionalLimit(params.limit);
  if (limit) queryParams.push(limit);
  const tokenFilterSql = tokenClauses.join("\n        OR ");
  const rows = (await db.queryAsync(
    `SELECT conversation_id AS conversationID,
            legacy_conversation_key AS conversationKey,
            system,
            kind,
            library_id AS libraryID,
            paper_item_id AS paperItemID,
            title,
            body_text AS bodyText,
            last_activity_at AS lastActivityAt,
            user_turn_count AS userTurnCount
     FROM ${CONVERSATION_SEARCH_INDEX_TABLE}
     WHERE system = ?
       AND library_id = ?
       AND user_turn_count > 0
       AND (${tokenFilterSql})
     ORDER BY last_activity_at DESC, legacy_conversation_key DESC
     ${limit ? "LIMIT ?" : ""}`,
    queryParams,
  )) as Array<Record<string, unknown>> | undefined;
  const matches = (rows || [])
    .map((row) => normalizeMatch(row))
    .filter((row): row is ConversationSearchIndexMatch => Boolean(row));
  const hasMissingIndexedRows =
    coverage.catalogRowCount > coverage.indexedRowCount ||
    coverage.missingIndexedRowCount > 0;
  const status: ConversationSearchIndexStatus =
    coverage.indexedRowCount <= 0 && coverage.catalogRowCount > 0
      ? "empty"
      : hasMissingIndexedRows
        ? "stale"
        : coverage.truncatedRowCount > 0
          ? "truncated"
          : "ready";
  return {
    matches,
    status,
    indexedRowCount: coverage.indexedRowCount,
    catalogRowCount: coverage.catalogRowCount,
    truncatedRowCount: coverage.truncatedRowCount,
  };
}
