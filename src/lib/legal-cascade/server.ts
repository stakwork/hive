import { NextRequest, NextResponse } from "next/server";
import { StakworkRunType } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { dedupeSessionsById } from "./derive";
import type {
  CascadeConcept,
  CascadeSession,
  CascadeTurn,
} from "./types";

/**
 * Shared server-side plumbing for the cascade proxy routes
 * (`/api/workspaces/[slug]/legal/benchmarks/cascade/*`). The browser NEVER
 * calls stakgraph `:3355` directly — these helpers resolve swarm access,
 * derive the run identifier, and enforce that any requested session belongs
 * to the run.
 */

const SESSION_LIST_LIMIT = 200;
const TURNS_PAGE_LIMIT = 1000;

export interface CascadeAccess {
  userId: string;
  slug: string;
  workspaceId: string;
  runId: string;
  /** Stakwork project id when set on the run — tried first as identifier. */
  projectId: number | null;
  /** stakgraph base URL (`:3355`), empty string in USE_MOCKS mode. */
  baseUrl: string;
  apiKey: string;
  useMocks: boolean;
}

function handleSwarmAccessError(error: { type: string }): NextResponse {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * Auth → openlaw gate → rate limit → swarm access → IDOR-guarded run lookup.
 * Mirrors the rubrics route template step for step.
 */
export async function resolveCascadeAccess(
  request: NextRequest,
  params: Promise<{ slug: string }>,
): Promise<CascadeAccess | NextResponse> {
  // Step 1: Auth
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { slug } = await params;

  // Step 2: Openlaw-only guard
  if (slug !== "openlaw") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Step 3: Parse + validate query
  const runId = new URL(request.url).searchParams.get("runId")?.trim();
  if (!runId) {
    return NextResponse.json({ error: "runId query param is required" }, { status: 400 });
  }

  // Step 4: Rate limit — keyed on the authenticated user (IP is spoofable),
  // with the IP as a fallback bucket for unauthenticated middleware setups.
  const rlKey = userId || getClientIp(request);
  const rl = await checkRateLimit(`legal-cascade:${rlKey}`, 240, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rl.retryAfter },
      { status: 429 },
    );
  }

  // Step 5: Resolve workspace swarm access
  const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
  if (!swarmResult.success) {
    return handleSwarmAccessError(swarmResult.error);
  }
  const { workspaceId, swarmUrl, swarmApiKey } = swarmResult.data;

  // Step 6: IDOR guard — id, workspaceId AND type in the WHERE clause, so a
  // cross-workspace or wrong-type runId 404s with no post-fetch check.
  const run = await db.stakworkRun.findFirst({
    where: {
      id: runId,
      workspaceId,
      type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    },
    select: { id: true, projectId: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return {
    userId,
    slug,
    workspaceId,
    runId,
    projectId: run.projectId,
    baseUrl: transformSwarmUrlToRepo2Graph(swarmUrl),
    apiKey: swarmApiKey,
    useMocks: process.env.USE_MOCKS === "true",
  };
}

/**
 * Run identifiers to try against `agent_name_contains`, most likely first.
 * The workflow embeds the Stakwork projectId in agent names
 * (`repair-agent-147813394`); the hive cuid is the fallback.
 */
export function runIdentifierCandidates(access: CascadeAccess): string[] {
  const candidates: string[] = [];
  if (access.projectId != null) candidates.push(String(access.projectId));
  candidates.push(access.runId);
  return candidates;
}

// ── Field allowlists ─────────────────────────────────────────────────────────
// Explicit mappers, mirroring the RunResponseRow discipline: never spread the
// upstream object into a response.

function asStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SESSION_STATUSES = new Set(["running", "success", "error", "aborted"]);

export function toCascadeSession(raw: unknown): CascadeSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const status = asStringOr(r.status, "running");
  const usage =
    r.token_usage && typeof r.token_usage === "object"
      ? (r.token_usage as Record<string, unknown>)
      : null;
  return {
    id: r.id,
    parent_session_id: asStringOr(r.parent_session_id, ""),
    agent_name: asStringOr(r.agent_name, ""),
    source: asStringOr(r.source, ""),
    status: (SESSION_STATUSES.has(status) ? status : "running") as CascadeSession["status"],
    turn_count: asNumberOrNull(r.turn_count) ?? 0,
    last_turn_at: asNumberOrNull(r.last_turn_at),
    timestamp: asStringOr(r.timestamp, ""),
    model: typeof r.model === "string" ? r.model : null,
    repo: typeof r.repo === "string" ? r.repo : null,
    token_usage: usage
      ? {
          input: asNumberOrNull(usage.input) ?? 0,
          cache_read: asNumberOrNull(usage.cache_read) ?? 0,
          cache_write: asNumberOrNull(usage.cache_write) ?? 0,
          output: asNumberOrNull(usage.output) ?? 0,
          total: asNumberOrNull(usage.total) ?? 0,
        }
      : null,
    child_count: asNumberOrNull(r.child_count) ?? 0,
  };
}

const TURN_TYPES = new Set([
  "user_input",
  "reasoning",
  "tool_call",
  "tool_result",
  "response",
]);

function toCascadeConcept(raw: unknown): CascadeConcept | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const refId = asStringOr(r.ref_id, "");
  const name = asStringOr(r.name, "");
  if (!refId && !name) return null;
  return { ref_id: refId, id: typeof r.id === "string" ? r.id : null, name };
}

export function toCascadeTurn(raw: unknown): CascadeTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const order = asNumberOrNull(r.order);
  if (order === null) return null;
  const turnType = asStringOr(r.turn_type, "");
  if (!TURN_TYPES.has(turnType)) return null;
  return {
    order,
    turn_id: asStringOr(r.turn_id, ""),
    turn_type: turnType as CascadeTurn["turn_type"],
    tool: typeof r.tool === "string" ? r.tool : null,
    tool_call_id: typeof r.tool_call_id === "string" ? r.tool_call_id : null,
    content: asStringOr(r.content, ""),
    timestamp: asNumberOrNull(r.timestamp),
    concepts: Array.isArray(r.concepts)
      ? r.concepts.map(toCascadeConcept).filter((c): c is CascadeConcept => c !== null)
      : [],
  };
}

// ── Upstream fetches ─────────────────────────────────────────────────────────

async function stakgraphGet(access: CascadeAccess, path: string): Promise<unknown> {
  // The /api/sessions router is currently mounted pre-auth on the swarm; the
  // token is harmless now and required if/when stakgraph gates that router.
  const res = await fetch(`${access.baseUrl}${path}`, {
    headers: { "x-api-token": access.apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`stakgraph responded ${res.status} for ${path}`);
  }
  return res.json();
}

export interface RunSessionsResult {
  /** The identifier that matched, null when no candidate returned sessions. */
  identifier: string | null;
  sessions: CascadeSession[];
}

/**
 * All top-level sessions of the run: try each identifier candidate against
 * `agent_name_contains` until one matches (projectId first — see the plan's
 * §1a open question).
 */
export async function fetchRunSessions(access: CascadeAccess): Promise<RunSessionsResult> {
  for (const candidate of runIdentifierCandidates(access)) {
    const body = (await stakgraphGet(
      access,
      `/api/sessions?agent_name_contains=${encodeURIComponent(candidate)}&limit=${SESSION_LIST_LIMIT}`,
    )) as { sessions?: unknown[] } | unknown[];
    const rawRows = Array.isArray(body) ? body : (body?.sessions ?? []);
    // Dedupe by id: the upstream list can transiently repeat a session until
    // its dedupe pass runs on the next repo2graph boot.
    const sessions = dedupeSessionsById(
      rawRows.map(toCascadeSession).filter((s): s is CascadeSession => s !== null),
    );
    if (sessions.length > 0) return { identifier: candidate, sessions };
  }
  return { identifier: null, sessions: [] };
}

/**
 * A requested session belongs to the run iff its root id (the id with every
 * `-sub-` suffix stripped) is one of the run's top-level sessions — the proxy
 * must not be usable to read arbitrary swarm sessions.
 */
export function sessionBelongsToRun(
  sessionId: string,
  runSessions: CascadeSession[],
): boolean {
  const subIdx = sessionId.indexOf("-sub-");
  const rootId = subIdx > 0 ? sessionId.slice(0, subIdx) : sessionId;
  return runSessions.some((s) => s.id === rootId);
}

export async function fetchSessionDetail(
  access: CascadeAccess,
  sessionId: string,
): Promise<{ session: CascadeSession; descendants: CascadeSession[] } | null> {
  const body = (await stakgraphGet(
    access,
    `/api/sessions/${encodeURIComponent(sessionId)}?recursive=true`,
  )) as Record<string, unknown> | null;
  const session = toCascadeSession(body);
  if (!session) return null;
  const rawDescendants = Array.isArray(body?.descendants)
    ? body.descendants
    : Array.isArray(body?.children)
      ? body.children
      : [];
  return {
    session,
    descendants: rawDescendants
      .map(toCascadeSession)
      .filter((s): s is CascadeSession => s !== null),
  };
}

export async function fetchSessionTurns(
  access: CascadeAccess,
  sessionId: string,
  after: number,
): Promise<{
  session_id: string;
  status: CascadeSession["status"];
  turn_count: number;
  last_turn_at: number | null;
  turns: CascadeTurn[];
} | null> {
  const body = (await stakgraphGet(
    access,
    `/api/sessions/${encodeURIComponent(sessionId)}/turns?after=${after}&limit=${TURNS_PAGE_LIMIT}`,
  )) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  const status = asStringOr(body.status, "running");
  return {
    session_id: asStringOr(body.session_id, sessionId),
    status: (SESSION_STATUSES.has(status) ? status : "running") as CascadeSession["status"],
    turn_count: asNumberOrNull(body.turn_count) ?? 0,
    last_turn_at: asNumberOrNull(body.last_turn_at),
    turns: Array.isArray(body.turns)
      ? body.turns.map(toCascadeTurn).filter((t): t is CascadeTurn => t !== null)
      : [],
  };
}

/** Identifier used to parameterize mock fixtures under USE_MOCKS. */
export function mockIdentifier(access: CascadeAccess): string {
  return access.projectId != null ? String(access.projectId) : access.runId;
}
