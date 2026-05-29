import { assert } from "chai";
import {
  CONVERSATION_SEARCH_BODY_CHAR_LIMIT,
  CONVERSATION_SEARCH_INDEX_TABLE,
  deleteConversationSearchIndexRow,
  initConversationSearchIndexStore,
  refreshConversationSearchIndex,
  refreshConversationSearchIndexForConversation,
  refreshConversationSearchIndexForSystem,
  searchConversationIndex,
  searchConversationIndexWithStatus,
} from "../src/shared/conversationSearchIndex";

describe("conversation search index", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
  };
  const originalZotero = globalScope.Zotero;

  afterEach(function () {
    globalScope.Zotero = originalZotero;
  });

  function installSearchIndexDb(params: {
    tables?: string[];
    searchRows?: Array<Record<string, unknown>>;
    handleQuery?: (
      sql: string,
      queryParams?: unknown[],
    ) => Promise<unknown> | unknown;
  } = {}) {
    const tables = new Set(params.tables || []);
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    globalScope.Zotero = {
      DB: {
        queryAsync: async (sql: string, queryParams?: unknown[]) => {
          queries.push({ sql, params: queryParams });
          const handled = await params.handleQuery?.(sql, queryParams);
          if (handled !== undefined) return handled;
          if (sql.includes("FROM sqlite_master")) {
            const tableName = String(queryParams?.[0] || "");
            return tables.has(tableName) ? [{ name: tableName }] : [];
          }
          if (
            sql.includes(`FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`) &&
            sql.includes("WHERE system = ?") &&
            sql.includes("body_text AS bodyText")
          ) {
            return params.searchRows || [];
          }
          return [];
        },
      },
    };
    return { queries };
  }

  it("initializes a DB-backed search index table", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(await initConversationSearchIndexStore(), true);

    assert.isTrue(
      queries.some(
        ({ sql }) =>
          sql.includes("CREATE TABLE IF NOT EXISTS") &&
          sql.includes(CONVERSATION_SEARCH_INDEX_TABLE) &&
          sql.includes("conversation_id TEXT PRIMARY KEY") &&
          sql.includes("body_text TEXT NOT NULL"),
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql }) =>
          sql.includes("CREATE INDEX IF NOT EXISTS") &&
          sql.includes("(system, library_id, user_turn_count, last_activity_at DESC)"),
      ),
    );
  });

  it("refreshes upstream, Claude, and Codex catalogs into the shared index", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
        "llm_for_zotero_claude_conversations",
        "llm_for_zotero_claude_messages",
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
    });

    assert.equal(await refreshConversationSearchIndex(), true);

    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_global_conversations") &&
          sql.includes("llm_for_zotero_chat_messages") &&
          !sql.includes("c.updated_at") &&
          params?.[0] === "upstream",
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_claude_conversations") &&
          sql.includes("llm_for_zotero_claude_messages") &&
          params?.[0] === "claude_code",
      ),
    );
    assert.isTrue(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_codex_conversations") &&
          sql.includes("llm_for_zotero_codex_messages") &&
          params?.[0] === "codex",
      ),
    );
  });

  it("searches indexed rows by current system and library", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
      searchRows: [
        {
          conversationID: "codex-chat-1",
          conversationKey: 8101,
          system: "codex",
          kind: "paper",
          libraryID: 2,
          paperItemID: 44,
          title: "Decoder margin",
          bodyText: "A discussion of stable decoding under drift.",
          lastActivityAt: 1234,
          userTurnCount: 2,
        },
      ],
    });

    const rows = await searchConversationIndex({
      system: "codex",
      libraryID: 2,
      query: "decoder drift",
      limit: 10,
    });

    assert.deepEqual(rows, [
      {
        conversationID: "codex-chat-1",
        conversationKey: 8101,
        system: "codex",
        kind: "paper",
        libraryID: 2,
        paperItemID: 44,
        title: "Decoder margin",
        bodyText: "A discussion of stable decoding under drift.",
        lastActivityAt: 1234,
        userTurnCount: 2,
      },
    ]);
    const searchQuery = queries.find(
      ({ sql }) =>
        sql.includes(`FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`) &&
        sql.includes("body_text AS bodyText"),
    );
    const searchSql = searchQuery?.sql || "";
    const tokenFilterSql = searchSql.slice(
      searchSql.indexOf("user_turn_count > 0"),
    );
    assert.include(
      tokenFilterSql,
      "\n        OR (LOWER(COALESCE(title, '')) LIKE ?",
    );
    assert.notInclude(
      tokenFilterSql,
      "\n       AND (LOWER(COALESCE(title, '')) LIKE ?",
    );
    assert.deepEqual(searchQuery?.params, [
      "codex",
      2,
      "%decoder%",
      "%decoder%",
      "%decoder%",
      "%drift%",
      "%drift%",
      "%drift%",
      10,
    ]);
    assert.isFalse(
      queries.some(({ sql }) => sql.includes("INSERT OR REPLACE INTO")),
    );
  });

  it("refreshes before searching only when explicitly requested", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
    });

    await searchConversationIndex({
      system: "codex",
      libraryID: 2,
      query: "decoder",
      refresh: true,
    });

    assert.isTrue(
      queries.some(
        ({ sql }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_codex_conversations"),
      ),
    );
  });

  it("searches scope labels without applying a default result cap", async function () {
    const { queries } = installSearchIndexDb({
      searchRows: [
        {
          conversationID: "codex-global-1",
          conversationKey: 8101,
          system: "codex",
          kind: "global",
          libraryID: 2,
          paperItemID: null,
          title: "General setup",
          bodyText: "No explicit scope keyword here.",
          lastActivityAt: 1234,
          userTurnCount: 1,
        },
      ],
    });

    const rows = await searchConversationIndex({
      system: "codex",
      libraryID: 2,
      query: "library",
    });

    assert.lengthOf(rows, 1);
    const searchQuery = queries.find(
      ({ sql }) =>
        sql.includes(`FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`) &&
        sql.includes("body_text AS bodyText"),
    );
    assert.include(searchQuery?.sql || "", "library chat");
    assert.notInclude(searchQuery?.sql || "", "LIMIT ?");
    assert.deepEqual(searchQuery?.params, [
      "codex",
      2,
      "%library%",
      "%library%",
      "%library%",
    ]);
  });

  it("reports empty coverage when catalog rows are missing from an empty index", async function () {
    installSearchIndexDb({
      tables: ["llm_for_zotero_codex_conversations"],
      handleQuery: (sql) => {
        if (sql.includes("COUNT(*) AS indexedRowCount")) {
          return [{ indexedRowCount: 0, truncatedRowCount: 0 }];
        }
        if (sql.includes("COUNT(*) AS catalogRowCount")) {
          return [{ catalogRowCount: 1, missingIndexedRowCount: 1 }];
        }
        return undefined;
      },
    });

    const result = await searchConversationIndexWithStatus({
      system: "codex",
      libraryID: 2,
      query: "decoder",
    });

    assert.equal(result.status, "empty");
    assert.equal(result.indexedRowCount, 0);
    assert.equal(result.catalogRowCount, 1);
    assert.equal(result.truncatedRowCount, 0);
    assert.deepEqual(result.matches, []);
  });

  it("reports stale coverage when some catalog rows are missing from the index", async function () {
    installSearchIndexDb({
      tables: ["llm_for_zotero_codex_conversations"],
      handleQuery: (sql) => {
        if (sql.includes("COUNT(*) AS indexedRowCount")) {
          return [{ indexedRowCount: 1, truncatedRowCount: 0 }];
        }
        if (sql.includes("COUNT(*) AS catalogRowCount")) {
          return [{ catalogRowCount: 2, missingIndexedRowCount: 1 }];
        }
        return undefined;
      },
    });

    const result = await searchConversationIndexWithStatus({
      system: "codex",
      libraryID: 2,
      query: "decoder",
    });

    assert.equal(result.status, "stale");
    assert.equal(result.indexedRowCount, 1);
    assert.equal(result.catalogRowCount, 2);
  });

  it("reports truncated coverage when indexed bodies hit the storage limit", async function () {
    installSearchIndexDb({
      tables: ["llm_for_zotero_codex_conversations"],
      searchRows: [
        {
          conversationID: "codex-chat-1",
          conversationKey: 8101,
          system: "codex",
          kind: "global",
          libraryID: 2,
          paperItemID: null,
          title: "Large chat",
          bodyText: "decoder",
          lastActivityAt: 1234,
          userTurnCount: 1,
        },
      ],
      handleQuery: (sql) => {
        if (sql.includes("COUNT(*) AS indexedRowCount")) {
          return [{ indexedRowCount: 1, truncatedRowCount: 1 }];
        }
        if (sql.includes("COUNT(*) AS catalogRowCount")) {
          return [{ catalogRowCount: 1, missingIndexedRowCount: 0 }];
        }
        return undefined;
      },
    });

    const result = await searchConversationIndexWithStatus({
      system: "codex",
      libraryID: 2,
      query: "decoder",
    });

    assert.equal(result.status, "truncated");
    assert.equal(result.truncatedRowCount, 1);
    assert.lengthOf(result.matches, 1);
  });

  it("does not refresh missing store tables", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(await refreshConversationSearchIndexForSystem("claude_code"), true);

    assert.isFalse(
      queries.some(
        ({ sql }) =>
          sql.includes("INSERT OR REPLACE INTO") &&
          sql.includes("llm_for_zotero_claude_conversations"),
      ),
    );
  });

  it("refreshes one indexed conversation by legacy key", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
      ],
    });

    assert.equal(
      await refreshConversationSearchIndexForConversation({
        system: "upstream",
        conversationKey: 1005,
      }),
      true,
    );

    const refreshQueries = queries.filter(
      ({ sql }) =>
        sql.includes("INSERT OR REPLACE INTO") &&
        sql.includes(CONVERSATION_SEARCH_INDEX_TABLE),
    );
    assert.lengthOf(refreshQueries, 2);
    assert.isTrue(
      refreshQueries.every(
        ({ sql, params }) =>
          sql.includes("AND (c.conversation_key = ?)") &&
          params?.[0] === "upstream" &&
          params?.[4] === 1005,
      ),
    );
  });

  it("refreshes one indexed conversation by canonical id", async function () {
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_codex_conversations",
        "llm_for_zotero_codex_messages",
      ],
    });

    assert.equal(
      await refreshConversationSearchIndexForConversation({
        system: "codex",
        conversationID: "lfz:user:codex:global:lib-1:legacy-8101",
        conversationKey: 8101,
      }),
      true,
    );

    const refreshQuery = queries.find(
      ({ sql }) =>
        sql.includes("INSERT OR REPLACE INTO") &&
        sql.includes("llm_for_zotero_codex_conversations"),
    );
    assert.isOk(refreshQuery);
    assert.include(refreshQuery?.sql || "", "AND (c.conversation_id = ?)");
    assert.include(refreshQuery?.sql || "", "GROUP_CONCAT(SUBSTR(m.text");
    assert.deepEqual(refreshQuery?.params, [
      "codex",
      CONVERSATION_SEARCH_BODY_CHAR_LIMIT,
      CONVERSATION_SEARCH_BODY_CHAR_LIMIT,
      refreshQuery?.params?.[3],
      "lfz:user:codex:global:lib-1:legacy-8101",
    ]);
  });

  it("repairs safe stale message ids before indexing conversations", async function () {
    const canonicalID = "lfz:profile:upstream:global:lib-2:paper-0:legacy-1005";
    const staleID = "legacy-stale-1005";
    const { queries } = installSearchIndexDb({
      tables: [
        "llm_for_zotero_global_conversations",
        "llm_for_zotero_paper_conversations",
        "llm_for_zotero_chat_messages",
      ],
      handleQuery: (sql, queryParams) => {
        if (
          sql.includes("FROM llm_for_zotero_global_conversations c") &&
          sql.includes("c.conversation_id AS conversationID")
        ) {
          return [
            {
              conversationID: canonicalID,
              conversationKey: 1005,
              libraryID: 2,
              kind: "global",
              paperItemID: null,
            },
          ];
        }
        if (
          sql.includes("FROM llm_for_zotero_paper_conversations c") &&
          sql.includes("c.conversation_id AS conversationID")
        ) {
          return [];
        }
        if (
          sql.includes("SELECT DISTINCT conversation_id AS conversationID") &&
          sql.includes("FROM llm_for_zotero_chat_messages") &&
          queryParams?.[0] === 1005
        ) {
          return [{ conversationID: canonicalID }, { conversationID: staleID }];
        }
        return undefined;
      },
    });

    assert.equal(await refreshConversationSearchIndexForSystem("upstream"), true);

    const repairQuery = queries.find(
      ({ sql }) =>
        sql.includes("UPDATE llm_for_zotero_chat_messages") &&
        sql.includes("SET conversation_id = ?") &&
        sql.includes("OR conversation_id = ?"),
    );
    assert.deepEqual(repairQuery?.params, [canonicalID, 1005, staleID]);
    const repairIndex = queries.findIndex(({ sql }) =>
      sql.includes("UPDATE llm_for_zotero_chat_messages"),
    );
    const indexInsertIndex = queries.findIndex(({ sql }) =>
      sql.includes(`INSERT OR REPLACE INTO ${CONVERSATION_SEARCH_INDEX_TABLE}`),
    );
    assert.isAtLeast(repairIndex, 0);
    assert.isAtLeast(indexInsertIndex, 0);
    assert.isBelow(repairIndex, indexInsertIndex);
  });

  it("deletes indexed rows by id or scoped legacy key", async function () {
    const { queries } = installSearchIndexDb();

    assert.equal(
      await deleteConversationSearchIndexRow({
        conversationID: "lfz:user:codex:paper:lib-1:paper-44:legacy-8101",
      }),
      true,
    );
    assert.equal(
      await deleteConversationSearchIndexRow({
        system: "claude_code",
        conversationKey: 7101,
      }),
      true,
    );

    const deletes = queries.filter(({ sql }) =>
      sql.includes(`DELETE FROM ${CONVERSATION_SEARCH_INDEX_TABLE}`),
    );
    assert.lengthOf(deletes, 2);
    assert.include(deletes[0].sql, "WHERE conversation_id = ?");
    assert.deepEqual(deletes[0].params, [
      "lfz:user:codex:paper:lib-1:paper-44:legacy-8101",
    ]);
    assert.include(deletes[1].sql, "WHERE system = ?");
    assert.include(deletes[1].sql, "AND legacy_conversation_key = ?");
    assert.deepEqual(deletes[1].params, ["claude_code", 7101]);
  });
});
