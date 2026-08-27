/**
 * Shared workspace graph-query service.
 *
 * Extracted from `src/app/api/workspaces/[slug]/graph/query/route.ts` so both
 * that admin HTTP route and (in a follow-on task) a server-side agent tool can
 * run a read-only Cypher query against a workspace's stakgraph instance
 * through ONE authorization gate and ONE code path.
 *
 * The gate order below intentionally mirrors the pre-extraction route exactly
 * (the integration suite pins it):
 *   access → admin → query validation → write-keyword guard → mocks →
 *   swarm resolution → upstream fetch.
 *
 * Request-free by design: callers pass explicit values, never a NextRequest,
 * so this can be called off the request path.
 */

import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import { validateWorkspaceAccess } from "@/services/workspace";
import { buildMockGraphQueryResult } from "@/app/api/mock/graph/query/fixture";

/** Upstream sets no transaction timeout of its own — bound every call. */
export const GRAPH_QUERY_TIMEOUT_MS = 30_000;

/** Upstream stakgraph rejects longer queries with an opaque error (16KB body cap). */
export const GRAPH_QUERY_MAX_LENGTH = 4096;

// ── Result types ─────────────────────────────────────────────────────────────

export interface GraphQueryMeta {
  /** The limit forwarded upstream (`limit ?? 100`); never clamped here. */
  requestedLimit: number;
  /**
   * True when the submitted Cypher contained a `LIMIT` token. Upstream strips
   * *all* submitted LIMIT clauses (including inner `WITH … LIMIT n`) and
   * appends its own final LIMIT, so callers should warn rather than silently
   * return wrong top-N results.
   */
  limitRewritten: boolean;
}

export type WorkspaceGraphQuerySuccess = {
  ok: true;
  /** Upstream JSON payload passed through intact (including `columns`). */
  data: unknown;
  meta: GraphQueryMeta;
};

export type WorkspaceGraphQueryFailure = {
  ok: false;
  status: number;
  message: string;
  details?: unknown;
};

export type WorkspaceGraphQueryResult =
  | WorkspaceGraphQuerySuccess
  | WorkspaceGraphQueryFailure;

// ── Write-query detection ────────────────────────────────────────────────────

/**
 * Matches single- or double-quoted string literals in one alternating pass so
 * apostrophes inside double-quoted strings (and vice versa) don't confuse the
 * scanner.
 */
const STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

interface WritePattern {
  label: string;
  re: RegExp;
}

// NOTE: this is a keyword denylist for defense in depth, NOT a driver-level
// guarantee. Upstream `execute_raw_cypher` runs on the shared read/write bolt
// connection with no `AccessMode::Read`; true read-mode enforcement is a
// stakwork/stakgraph-side change (out of scope for this repo).
//
// Read-only procedures (`apoc.convert.*`, `db.index.fulltext.queryNodes`,
// …) are deliberately NOT listed so legitimate analytical queries keep working.
const WRITE_PATTERNS: WritePattern[] = [
  { label: "CREATE", re: /\bCREATE\b/i },
  { label: "MERGE", re: /\bMERGE\b/i },
  { label: "SET", re: /\bSET\b/i },
  { label: "DELETE", re: /\bDELETE\b/i },
  { label: "REMOVE", re: /\bREMOVE\b/i },
  { label: "DROP", re: /\bDROP\b/i },
  { label: "FOREACH", re: /\bFOREACH\s*\(/i },
  { label: "LOAD CSV", re: /\bLOAD\s+CSV\b/i },
  // apoc write helpers (create/merge/periodic commits, atomic ops, refactors)
  {
    label: "CALL apoc.create",
    re: /\bCALL\s+apoc\.create\./i,
  },
  { label: "CALL apoc.merge", re: /\bCALL\s+apoc\.merge\./i },
  { label: "CALL apoc.periodic", re: /\bCALL\s+apoc\.periodic\./i },
  { label: "CALL apoc.atomic", re: /\bCALL\s+apoc\.atomic\./i },
  { label: "CALL apoc.refactor", re: /\bCALL\s+apoc\.refactor\./i },
  // dbms.* procedures are all admin/control-plane operations
  { label: "CALL dbms", re: /\bCALL\s+dbms\./i },
  // db.create.* property setters (e.g. db.create.setProperty)
  { label: "CALL db.create", re: /\bCALL\s+db\.create\./i },
];

/**
 * True when the Cypher looks like it mutates data.
 *
 * String literals are stripped FIRST so read queries like
 * `WHERE n.name CONTAINS 'delete'` are not false positives.
 */
export function isWriteQuery(query: string): boolean {
  const stripped = query.replace(STRING_LITERAL_RE, "");
  return WRITE_PATTERNS.some(({ re }) => re.test(stripped));
}

/** First write-keyword matched by `isWriteQuery`, or null. Never logs query text. */
export function matchWriteKeyword(query: string): string | null {
  const stripped = query.replace(STRING_LITERAL_RE, "");
  const hit = WRITE_PATTERNS.find(({ re }) => re.test(stripped));
  return hit ? hit.label : null;
}

// ── Service ──────────────────────────────────────────────────────────────────

function deny(
  slug: string,
  userId: string,
  reason:
    | "not-member"
    | "not-admin"
    | "no-swarm"
    | "write-keyword"
    | "query-too-long",
  status: number,
  message: string,
): WorkspaceGraphQueryFailure {
  console.log("[GraphQuery] denied:", slug, userId, reason);
  return { ok: false, status, message };
}

export interface RunWorkspaceGraphQueryArgs {
  slug: string;
  userId: string;
  query: unknown;
  limit?: unknown;
  timeoutMs?: number;
}

/**
 * Run a read-only Cypher query against a workspace's stakgraph instance,
 * enforcing membership + admin on `userId`.
 */
export async function runWorkspaceGraphQuery({
  slug,
  userId,
  query,
  limit,
  timeoutMs,
}: RunWorkspaceGraphQueryArgs): Promise<WorkspaceGraphQueryResult> {
  // 1) IDOR / authorization gate — must precede any credential resolution.
  const access = await validateWorkspaceAccess(slug, userId, true);
  if (!access.hasAccess) {
    return deny(slug, userId, "not-member", 404, "Workspace not found or access denied");
  }
  if (!access.canAdmin) {
    return deny(slug, userId, "not-admin", 403, "Forbidden: admin access required");
  }

  // 2) Query validation.
  if (!query || typeof query !== "string") {
    return { ok: false, status: 400, message: "query is required" };
  }
  if (query.length > GRAPH_QUERY_MAX_LENGTH) {
    console.log("[GraphQuery] denied:", slug, userId, "query-too-long");
    return {
      ok: false,
      status: 400,
      message: `query is too long (max ${GRAPH_QUERY_MAX_LENGTH} characters)`,
    };
  }

  // 3) Read-only guard (keyword denylist — see note above WRITE_PATTERNS).
  const writeKeyword = matchWriteKeyword(query);
  if (writeKeyword) {
    // Log the matched keyword only — never the raw query text at info level.
    console.log("[GraphQuery] denied:", slug, userId, "write-keyword", writeKeyword);
    return {
      ok: false,
      status: 403,
      message: "Write operations are not permitted",
    };
  }

  // Forwarded UNCLAMPED (upstream already applies min(limit, 1000)); bounding
  // belongs to the agent tool path, not this shared admin contract.
  const requestedLimit = (limit ?? 100) as number;
  const limitRewritten = /\bLIMIT\b/i.test(query);
  const meta: GraphQueryMeta = { requestedLimit, limitRewritten };

  // 4) Mock branch — same fixture the mock route serves, no outbound fetch.
  //
  // NOTE: checked at call time (not via `config.USE_MOCKS`, which freezes at
  // module import). Tests flip process.env.USE_MOCKS per test, so a
  // load-time constant would silently disable mock mode here.
  if (process.env.USE_MOCKS === "true") {
    return {
      ok: true,
      data: buildMockGraphQueryResult({ query }),
      meta,
    };
  }

  // 5) Swarm resolution.
  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true },
  });

  if (!workspace) {
    return deny(slug, userId, "no-swarm", 404, "Workspace not found");
  }

  // Already resolves + decrypts the Swarm row's swarmApiKey. Callers must
  // treat missing keys as a config problem, not an exception.
  const swarmAccess = await getSwarmAccessByWorkspaceId(workspace.id);

  if (
    !swarmAccess.success ||
    !swarmAccess.data.swarmName ||
    !swarmAccess.data.swarmApiKey
  ) {
    // 400 specifically — the Graph Explorer UI keys `setNotConfigured` off
    // HTTP 400. Do not remap to 404/500.
    return deny(
      slug,
      userId,
      "no-swarm",
      400,
      "Graph DB not configured for this workspace",
    );
  }

  let apiKey = swarmAccess.data.swarmApiKey;

  if (process.env.CUSTOM_SWARM_API_KEY) {
    apiKey = process.env.CUSTOM_SWARM_API_KEY;
  }

  const stakgraphUrl = getStakgraphUrl(
    getSwarmVanityAddress(swarmAccess.data.swarmName),
  );

  // 6) Forward to stakgraph with a hard timeout — upstream applies no
  //    transaction timeout, so one cartesian-product query could otherwise pin
  //    the shared Neo4j instance.
  const startedAt = Date.now();
  let apiResult: Response;
  try {
    apiResult = await fetch(`${stakgraphUrl}/api/hive/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
      body: JSON.stringify({
        language: "cypher",
        query,
        limit: requestedLimit,
      }),
      signal: AbortSignal.timeout(timeoutMs ?? GRAPH_QUERY_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      console.log("[GraphQuery] timeout:", slug, Date.now() - startedAt, "ms");
      return {
        ok: false,
        status: 504,
        message:
          "Graph query timed out — narrow the pattern or add a more selective anchor",
      };
    }
    throw error;
  }

  if (!apiResult.ok) {
    const details = await apiResult.json().catch(() => ({}));
    console.log("[GraphQuery] upstream error:", slug, apiResult.status);
    return {
      ok: false,
      status: apiResult.status,
      message: "Query failed",
      details,
    };
  }

  const data = await apiResult.json();
  return { ok: true, data, meta };
}
