/**
 * OpenHealth Benchmarks' strut access — every route in
 * `src/app/api/workspaces/[slug]/openhealth/benchmarks/**` resolves its
 * target strut through `resolveOpenHealthStrut`, and reads/writes run rows
 * through `fetchOwnedRun`. There is no other path to the lab from these
 * routes.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { resolveStrutTarget, type StrutTarget } from "@/services/strut-target";
import { strutFetch } from "@/lib/strut/fetch";
import { logger } from "@/lib/logger";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";
import { resolveOpenHealthStrutWorkflowName } from "./constants";
import { OPENHEALTH_LIST_TASKS_WORKFLOW } from "./contract";

const LOG_TAG = "openhealth-benchmarks";

/**
 * The two — and only two — strut workflow names any OpenHealth benchmark
 * route may build a URL from. `run` respects the existing
 * `OPENHEALTH_STRUT_WORKFLOW_NAME` env override (so runs launched under an
 * overridden name keep appearing); `listTasks` is fixed.
 */
export const OPENHEALTH_WORKFLOWS = {
  get run(): string {
    return resolveOpenHealthStrutWorkflowName();
  },
  listTasks: OPENHEALTH_LIST_TASKS_WORKFLOW,
} as const;

export type OpenHealthWorkflowKey = keyof typeof OPENHEALTH_WORKFLOWS;

const NOT_FOUND = { error: "Not found" } as const;
const STRUT_UNAVAILABLE = { error: "Strut unavailable" } as const;

export interface ResolveOpenHealthStrutOk {
  ok: true;
  target: StrutTarget;
  userId: string;
}
export interface ResolveOpenHealthStrutErr {
  ok: false;
  response: NextResponse;
}
export type ResolveOpenHealthStrutResult = ResolveOpenHealthStrutOk | ResolveOpenHealthStrutErr;

/**
 * Resolve the ONE strut every OpenHealth benchmark call may reach: the
 * `hive` workspace's own swarm. Steps, in order:
 *
 *   1. slug gate (`OPENHEALTH_SLUGS`) — before any DB access.
 *   2. `validateWorkspaceAccess` — `canWrite` when `opts.write`, else
 *      `canRead`. Kept even though `resolveStrutTarget` also checks
 *      membership, because that check does not distinguish `canWrite`.
 *   3. `resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "hive",
 *      userId })`.
 *
 * Every failure maps to a FIXED body — `describeStrutTargetError`'s prose is
 * never forwarded to the client (it can name the failure mode in detail;
 * that is for logs only). Slug / access / not-found → 404. Swarm not
 * active, decrypt failure, or no lab configured → 503.
 *
 * IMPORTANT: `benchmark` is pinned to the `"workspace"` policy row in
 * `strut-target.ts` — the hive workspace's OWN swarm, not the org default.
 * This resolver is called on EVERY read (not only at dispatch), so if that
 * policy line ever flips to `"org-default"`, history and task lists would
 * silently start being read from a different swarm. A test pins this.
 */
export async function resolveOpenHealthStrut(
  req: NextRequest,
  slug: string,
  opts: { write: boolean },
): Promise<ResolveOpenHealthStrutResult> {
  if (!OPENHEALTH_SLUGS.includes(slug)) {
    return { ok: false, response: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }

  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) {
    return { ok: false, response: userOrResponse };
  }
  const userId = userOrResponse.id;

  const access = await validateWorkspaceAccess(slug, userId, true, {});
  const allowed = opts.write ? access.canWrite : access.canRead;
  if (!allowed) {
    return { ok: false, response: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }

  // The literal "hive" — not the URL slug — so a resolver bug or a future
  // relaxation of OPENHEALTH_SLUGS can never point this at another
  // workspace's swarm. The slug gate above already forced slug === "hive".
  const resolved = await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "hive", userId });
  if (!resolved.ok) {
    const { type } = resolved.error;
    const status =
      type === "WORKSPACE_NOT_FOUND" || type === "ACCESS_DENIED" ? 404 : 503;
    logger.warn("[openhealth-benchmarks] strut resolution failed", LOG_TAG, {
      userId,
      errorType: type,
    });
    return {
      ok: false,
      response: NextResponse.json(status === 404 ? NOT_FOUND : STRUT_UNAVAILABLE, { status }),
    };
  }

  return { ok: true, target: resolved.target, userId };
}

/** Strict run id shape — strut run ids are millisecond timestamps. */
const RUN_ID_RE = /^\d{1,20}$/;

export function isValidRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId);
}

export interface OwnedRunOk {
  ok: true;
  summary: Record<string, unknown>;
}
export interface OwnedRunErr {
  ok: false;
  response: NextResponse;
}
export type OwnedRunResult = OwnedRunOk | OwnedRunErr;

/** Raw `GET {lab}/workflows/:workflow/runs/:runId}`, no ownership check. */
async function getRunDetailRaw(
  target: StrutTarget,
  workflow: string,
  runId: string,
): Promise<{ ok: true; summary: Record<string, unknown> } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await strutFetch(
      target,
      `/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
    );
  } catch {
    return { ok: false, status: 503 };
  }
  if (res.status === 404) return { ok: false, status: 404 };
  if (res.status === 501) return { ok: false, status: 503 };
  if (!res.ok) return { ok: false, status: 502 };

  try {
    return { ok: true, summary: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 502 };
  }
}

/**
 * `GET {lab}/workflows/openhealth-run/runs/:runId`, then require the
 * returned `workflow` to equal the OpenHealth run workflow name. This is
 * the ownership gate for the detail, cancel, stream and sheet routes —
 * strut's per-run artifact store and its event-log tail are NOT themselves
 * scoped to a workflow, so without this check a caller could pass any
 * runId from any workflow on the swarm and read/tail/cancel it. An unknown
 * or foreign run returns 404, identical to a malformed one — no existence
 * leak either way.
 */
export async function fetchOwnedRun(target: StrutTarget, runId: string): Promise<OwnedRunResult> {
  if (!isValidRunId(runId)) {
    return { ok: false, response: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }

  const workflow = OPENHEALTH_WORKFLOWS.run;
  const raw = await getRunDetailRaw(target, workflow, runId);
  if (!raw.ok) {
    const status = raw.status;
    return {
      ok: false,
      response: NextResponse.json(status === 404 ? NOT_FOUND : STRUT_UNAVAILABLE, {
        status: status === 404 ? 404 : status,
      }),
    };
  }

  if (raw.summary.workflow !== workflow) {
    // Belongs to a different workflow on the same swarm — 404, not 403.
    return { ok: false, response: NextResponse.json(NOT_FOUND, { status: 404 }) };
  }

  return { ok: true, summary: raw.summary };
}

/**
 * Backfill helper for the `runs` list route: fetch full detail for a run
 * ALREADY KNOWN to belong to `workflow` (it came from that workflow's own
 * list endpoint) — no ownership re-check needed. Returns `null` on any
 * failure so one bad row degrades to its minimal list shape rather than
 * failing the whole list.
 */
export async function fetchRunDetailForWorkflow(
  target: StrutTarget,
  workflow: string,
  runId: string,
): Promise<Record<string, unknown> | null> {
  if (!isValidRunId(runId)) return null;
  const raw = await getRunDetailRaw(target, workflow, runId);
  return raw.ok ? raw.summary : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ListedRun {
  runId: string;
  workflow: string;
  [key: string]: unknown;
}

export interface ListWorkflowRunsOk {
  ok: true;
  runs: ListedRun[];
}
export interface ListWorkflowRunsErr {
  ok: false;
  response: NextResponse;
}
export type ListWorkflowRunsResult = ListWorkflowRunsOk | ListWorkflowRunsErr;

/**
 * `GET {lab}/workflows/:workflow/runs` — the list endpoint both the
 * `tasks` GET (list-tasks workflow) and the `runs` GET / duplicate-run
 * check (run workflow) read from. Accepts either a bare array or
 * `{ runs: [...] }`, and filters again by `workflow` on the server — the
 * shared rule that only the two `OPENHEALTH_WORKFLOWS` URLs are ever
 * queried, and their results are never trusted to already be scoped.
 */
export async function listWorkflowRuns(
  target: StrutTarget,
  workflow: string,
): Promise<ListWorkflowRunsResult> {
  let res: Response;
  try {
    res = await strutFetch(target, `/workflows/${encodeURIComponent(workflow)}/runs`, { method: "GET" });
  } catch {
    return { ok: false, response: NextResponse.json(STRUT_UNAVAILABLE, { status: 503 }) };
  }
  if (!res.ok) {
    return { ok: false, response: NextResponse.json(STRUT_UNAVAILABLE, { status: 502 }) };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, response: NextResponse.json(STRUT_UNAVAILABLE, { status: 502 }) };
  }

  const rows = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.runs)
      ? body.runs
      : [];

  const filtered = rows.filter(
    (r): r is ListedRun => isRecord(r) && r.workflow === workflow && typeof r.runId === "string",
  );
  return { ok: true, runs: filtered };
}

/** Fixed error bodies, exported so routes and tests share the exact literal. */
export const OPENHEALTH_NOT_FOUND_BODY = NOT_FOUND;
export const OPENHEALTH_STRUT_UNAVAILABLE_BODY = STRUT_UNAVAILABLE;
