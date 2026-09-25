import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { classifyCallerToken } from "@/lib/auth/caller-token";

/**
 * Shared auth + authorization for the three workflow-callback routes:
 * `POST /api/chat/response`, `POST /api/webhook/agent-logs`,
 * `PUT /api/tasks/[taskId]/webhook`.
 *
 * The system `API_TOKEN` path is unchanged (trusted for any workspace, no
 * DB reads here). An org `hiveorg_…` key may only act on tasks/features/runs
 * whose workspace belongs to that key's org — resolved from the *records* in
 * the request, never from caller-supplied fields like `workspace_id`.
 */

// 300 requests/min per org API key — generous for a legitimate orchestrator,
// tight enough to bound abuse of a leaked key.
export const CALLBACK_ORG_RATE_LIMIT = 300;
export const CALLBACK_ORG_RATE_LIMIT_WINDOW_SECS = 60;

// Cap for `summary` on the tasks webhook (org callers only).
export const CALLBACK_MAX_SUMMARY_LENGTH = 20_000;

export type CallbackCaller =
  | { kind: "system" }
  | { kind: "org"; orgId: string; apiKeyId: string };

type RejectReason =
  | "invalid_key"
  | "rate_limited"
  | "invalid_id"
  | "org_mismatch"
  | "target_not_found"
  | "workspace_deleted"
  | "workspace_no_org"
  | "ambiguous_workspace"
  | "workspace_id_mismatch"
  | "pod_org_mismatch"
  | "payload_not_allowed"
  | "system_log_overwrite"
  | "invalid_agent"
  | "invalid_branch";

function warn(reason: RejectReason, details?: Record<string, unknown>) {
  // Key material is never logged — only ids.
  console.warn("[callback-access] rejected", { reason, ...details });
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Authenticate a callback request. Must run before the body is parsed.
 * - `null` from `classifyCallerToken` → 401.
 * - Org callers are rate-limited per key; system callers are not.
 */
export async function authenticateCallbackRequest(
  request: NextRequest,
): Promise<CallbackCaller | NextResponse> {
  const classified = await classifyCallerToken(request);

  if (!classified) {
    warn("invalid_key");
    return unauthorized();
  }

  if (classified.kind === "system") {
    return { kind: "system" };
  }

  const { orgId, apiKeyId } = classified;

  try {
    const limit = await checkRateLimit(
      `callback:${apiKeyId}`,
      CALLBACK_ORG_RATE_LIMIT,
      CALLBACK_ORG_RATE_LIMIT_WINDOW_SECS,
    );
    if (!limit.allowed) {
      warn("rate_limited", { orgId, apiKeyId });
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: limit.retryAfter ? { "Retry-After": String(limit.retryAfter) } : undefined,
        },
      );
    }
  } catch {
    // Fail open — rate limiting is best-effort, not an authz control.
  }

  return { kind: "org", orgId, apiKeyId };
}

// Permissive-but-typed id shape: rejects non-strings (objects/arrays), empty
// strings, and anything that isn't a reasonable id token. This is enough to
// stop an id being turned into a Prisma filter operator, while not assuming
// every id in the system is a strict `c…` cuid (some test/legacy ids aren't).
const ID_SHAPE = /^[A-Za-z0-9_-]{1,191}$/;

export interface RawCallbackIds {
  taskId?: unknown;
  featureId?: unknown;
  stakworkRunId?: unknown;
}

export interface ParsedCallbackIds {
  taskId?: string;
  featureId?: string;
  stakworkProjectId?: number;
}

function parseStringId(raw: unknown): string | null | undefined {
  // undefined/null → not provided (ok). Anything else must be a non-empty,
  // id-shaped string.
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !ID_SHAPE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate the shape of caller-supplied ids before any Prisma call.
 * Objects, arrays, and `NaN` all → 400.
 */
export function parseCallbackIds(raw: RawCallbackIds): ParsedCallbackIds | NextResponse {
  const result: ParsedCallbackIds = {};

  if (raw.taskId !== undefined && raw.taskId !== null) {
    const taskId = parseStringId(raw.taskId);
    if (!taskId) {
      warn("invalid_id", { field: "taskId" });
      return badRequest("Invalid taskId");
    }
    result.taskId = taskId;
  }

  if (raw.featureId !== undefined && raw.featureId !== null) {
    const featureId = parseStringId(raw.featureId);
    if (!featureId) {
      warn("invalid_id", { field: "featureId" });
      return badRequest("Invalid featureId");
    }
    result.featureId = featureId;
  }

  if (raw.stakworkRunId !== undefined && raw.stakworkRunId !== null) {
    const value = raw.stakworkRunId;
    const isPlainNumberOrString = typeof value === "number" || typeof value === "string";
    const num = isPlainNumberOrString ? Number(value) : NaN;
    if (!isPlainNumberOrString || !Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
      warn("invalid_id", { field: "stakworkRunId" });
      return badRequest("Invalid stakwork_run_id");
    }
    result.stakworkProjectId = num;
  }

  return result;
}

export interface AuthorizedCallback {
  caller: CallbackCaller;
  /** Only present for org callers — the single workspace all ids resolved to. */
  workspaceId?: string;
}

interface ResolvedTarget {
  workspaceId: string;
}

async function resolveTaskWorkspace(
  taskId: string,
  orgId: string,
): Promise<ResolvedTarget | "not_found" | "no_org" | "other_org"> {
  const task = await db.task.findFirst({
    where: { id: taskId, deleted: false, workspace: { deleted: false } },
    select: { workspaceId: true, workspace: { select: { sourceControlOrgId: true } } },
  });
  if (!task) return "not_found";
  if (!task.workspace.sourceControlOrgId) return "no_org";
  if (task.workspace.sourceControlOrgId !== orgId) return "other_org";
  return { workspaceId: task.workspaceId };
}

async function resolveFeatureWorkspace(
  featureId: string,
  orgId: string,
): Promise<ResolvedTarget | "not_found" | "no_org" | "other_org"> {
  const feature = await db.feature.findFirst({
    where: { id: featureId, deleted: false, workspace: { deleted: false } },
    select: { workspaceId: true, workspace: { select: { sourceControlOrgId: true } } },
  });
  if (!feature) return "not_found";
  if (!feature.workspace.sourceControlOrgId) return "no_org";
  if (feature.workspace.sourceControlOrgId !== orgId) return "other_org";
  return { workspaceId: feature.workspaceId };
}

/**
 * Authorize a callback request's targets against the caller.
 *
 * - System callers pass straight through with no DB reads (today's behaviour).
 * - Org callers must supply at least one id; every id must resolve to the
 *   SAME workspace, and that workspace must belong to the caller's org.
 *   "Not found" and "belongs to another org" both return 404 — the real
 *   reason is only in the server log — so an org key can't probe for the
 *   existence of ids outside its org.
 */
export async function authorizeCallbackTargets(
  caller: CallbackCaller,
  ids: { taskId?: string; featureId?: string; stakworkProjectId?: number },
): Promise<AuthorizedCallback | NextResponse> {
  if (caller.kind === "system") {
    return { caller };
  }

  const { orgId, apiKeyId } = caller;
  const { taskId, featureId, stakworkProjectId } = ids;

  if (!taskId && !featureId && !stakworkProjectId) {
    warn("invalid_id", { reason: "no_ids", orgId, apiKeyId });
    return badRequest("At least one of taskId, featureId, or stakwork_run_id is required");
  }

  const resolvedWorkspaceIds = new Set<string>();

  if (taskId) {
    const result = await resolveTaskWorkspace(taskId, orgId);
    if (result === "not_found") {
      warn("target_not_found", { orgId, apiKeyId, taskId });
      return notFound();
    }
    if (result === "no_org") {
      warn("workspace_no_org", { orgId, apiKeyId, taskId });
      return notFound();
    }
    if (result === "other_org") {
      warn("org_mismatch", { orgId, apiKeyId, taskId });
      return notFound();
    }
    resolvedWorkspaceIds.add(result.workspaceId);
  }

  if (featureId) {
    const result = await resolveFeatureWorkspace(featureId, orgId);
    if (result === "not_found") {
      warn("target_not_found", { orgId, apiKeyId, featureId });
      return notFound();
    }
    if (result === "no_org") {
      warn("workspace_no_org", { orgId, apiKeyId, featureId });
      return notFound();
    }
    if (result === "other_org") {
      warn("org_mismatch", { orgId, apiKeyId, featureId });
      return notFound();
    }
    resolvedWorkspaceIds.add(result.workspaceId);
  }

  if (stakworkProjectId) {
    // Narrow candidates by the task/feature workspace when one is already
    // known, so a `projectId` collision with another org's run never blocks
    // (or leaks) the rightful owner's run.
    const narrowWorkspaceId = resolvedWorkspaceIds.size === 1 ? [...resolvedWorkspaceIds][0] : undefined;

    const runs = await db.stakworkRun.findMany({
      where: {
        projectId: stakworkProjectId,
        workspace: {
          sourceControlOrgId: orgId,
          deleted: false,
          ...(narrowWorkspaceId ? { id: narrowWorkspaceId } : {}),
        },
      },
      select: { workspaceId: true },
    });

    if (runs.length === 0) {
      warn("target_not_found", { orgId, apiKeyId, stakworkProjectId });
      return notFound();
    }

    const runWorkspaceIds = new Set(runs.map((r) => r.workspaceId));
    if (runWorkspaceIds.size > 1) {
      warn("ambiguous_workspace", { orgId, apiKeyId, stakworkProjectId });
      return badRequest("Ambiguous workspace for stakwork_run_id");
    }
    for (const id of runWorkspaceIds) resolvedWorkspaceIds.add(id);
  }

  if (resolvedWorkspaceIds.size > 1) {
    warn("ambiguous_workspace", { orgId, apiKeyId, taskId, featureId, stakworkProjectId });
    return badRequest("Ids belong to different workspaces");
  }

  const [workspaceId] = resolvedWorkspaceIds;
  return { caller, workspaceId };
}

/** Git ref-name validation for org-caller `branch` updates (tasks/webhook). */
export function isValidGitBranchName(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (/\s/.test(branch)) return false;
  // Control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(branch)) return false;
  if (branch.includes("..")) return false;
  if (/[~^:?*[\\]/.test(branch)) return false;
  if (branch.startsWith("-")) return false;
  if (branch.endsWith(".lock") || branch.endsWith("/")) return false;
  return true;
}

export { notFound as callbackNotFound, badRequest as callbackBadRequest, unauthorized as callbackUnauthorized };
