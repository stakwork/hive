/**
 * Shared plumbing for the four EvalRequirement write routes:
 *
 *   POST/PUT /api/workspaces/:slug/evals/:evalSetId/requirements[/:reqId]
 *   POST/PUT /api/gateway/evals/:setId/requirements[/:reqId]
 *
 * Three concerns live here because all four routes need them identically:
 * loose-but-loud boolean coercion, ownership resolution of the target nodes,
 * and the role gate for the integrity-bearing `contested` field.
 */
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import type { JarvisConnectionConfig } from "@/types/jarvis";

// ── Loose boolean coercion ───────────────────────────────────────────────────

export type CoerceResult =
  | { ok: true; value: boolean }
  | { ok: false; error: string };

/**
 * Coerce an agent- or UI-supplied flag into a real JSON boolean.
 *
 * Accepts `true|false`, `1|0`, and `"true"|"false"` (case-insensitive, trimmed).
 * Anything else is an error, NOT a silent `false`: a strict `=== true` check
 * would turn an agent's `"true"` into `false` and still answer 200 — the exact
 * opposite of what it asked for. Loose in, loud on anything ambiguous.
 *
 * Jarvis declares `contested` as `?boolean`, so a non-boolean value would 400
 * the entire update upstream anyway; this converts that into a specific,
 * field-named 400 before any write is attempted.
 */
export function coerce(value: unknown, field: string): CoerceResult {
  if (typeof value === "boolean") return { ok: true, value };
  if (value === 1) return { ok: true, value: true };
  if (value === 0) return { ok: true, value: false };
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return { ok: true, value: true };
    if (normalized === "false") return { ok: true, value: false };
  }
  return {
    ok: false,
    error: `${field} must be a boolean (true/false, 1/0, or "true"/"false")`,
  };
}

// ── Ownership resolution ─────────────────────────────────────────────────────

/**
 * Jarvis ref_ids are opaque, but they are always word characters plus `-`/`_`.
 * Validating before interpolation keeps a caller-supplied id from steering the
 * Jarvis URL on a request that carries the decrypted swarm API key.
 */
const EVAL_REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidEvalRefId(value: unknown): value is string {
  return typeof value === "string" && EVAL_REF_ID_PATTERN.test(value);
}

export interface EvalRequirementNode {
  ref_id: string;
  node_type?: string;
  properties?: Record<string, unknown>;
}

export type EvalSetScopeResult =
  | { ok: true; requirements: EvalRequirementNode[] }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * Resolve an eval set within the CALLER'S swarm and return its
 * HAS_REQUIREMENT children.
 *
 * This is the ownership check. `evalSetId`/`setId`/`reqId` arrive as opaque
 * ref_ids that prove nothing about who may write them —
 * `getWorkspaceSwarmAccess` (and the gateway's API key) prove workspace
 * membership and nothing about the target node. Since `config` is derived from
 * the caller's own workspace, a set that does not resolve here is a set the
 * caller cannot address.
 *
 * Fails closed: the root node must come back in `nodes` and must be an EvalSet.
 * Every existing reader of this endpoint filters the root out of the neighbor
 * list, so its presence is the documented shape; treating its absence as "not
 * found" is the safe reading of an ambiguous response.
 *
 * 404 (never 403) on any mismatch, so the response does not confirm that some
 * other workspace's ref_id exists.
 */
export async function resolveEvalSetScope(
  config: JarvisConnectionConfig,
  setId: string,
): Promise<EvalSetScopeResult> {
  if (!isValidEvalRefId(setId)) {
    return { ok: false, status: 400, error: "Invalid eval set id" };
  }

  const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
  const url = `${config.jarvisUrl.replace(/\/$/, "")}/v2/nodes/${encodeURIComponent(
    setId,
  )}?expand=edges&edge_type=${edgeType}&depth=1`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-api-token": config.apiKey } });
  } catch (error) {
    console.error("[Eval Requirement Writes] eval set fetch error:", error);
    return { ok: false, status: 502, error: "Failed to resolve eval set" };
  }

  if (response.status === 404) {
    return { ok: false, status: 404, error: "Eval set not found" };
  }
  if (!response.ok) {
    console.error(
      `[Eval Requirement Writes] eval set fetch failed with status ${response.status}`,
    );
    return { ok: false, status: 502, error: "Failed to resolve eval set" };
  }

  const data = await response.json().catch(() => null);
  const nodes: EvalRequirementNode[] = Array.isArray(data?.nodes) ? data.nodes : [];

  // Jarvis node types come back inconsistently cased ("Evalset" /
  // "Evalrequirement") — match case-insensitively, as the read paths do.
  const root = nodes.find((n) => n?.ref_id === setId);
  if (!root || String(root.node_type ?? "").toLowerCase() !== "evalset") {
    return { ok: false, status: 404, error: "Eval set not found" };
  }

  const requirements = nodes.filter(
    (n) =>
      n?.ref_id !== setId &&
      String(n?.node_type ?? "").toLowerCase() === "evalrequirement",
  );

  return { ok: true, requirements };
}

/**
 * Find a requirement among an eval set's HAS_REQUIREMENT children.
 *
 * Membership in that list is what proves the requirement is reachable from the
 * given eval set AND is an EvalRequirement — `resolveEvalSetScope` has already
 * filtered on both. A `reqId` from a different eval set simply isn't here.
 */
export function findRequirement(
  requirements: EvalRequirementNode[],
  reqId: string,
): EvalRequirementNode | null {
  if (!isValidEvalRefId(reqId)) return null;
  return requirements.find((n) => n.ref_id === reqId) ?? null;
}

// ── Role gate for `contested` ────────────────────────────────────────────────

/**
 * Roles allowed to write `contested`.
 *
 * The workspace routes gate on `getWorkspaceSwarmAccess`, which admits ANY
 * `workspaceMember` with `leftAt: null` and performs no role check — so without
 * this a VIEWER or STAKEHOLDER could flip a flag that affects scoring.
 *
 * Deliberately a separate constant from `RUN_REPORT_ALLOWED_ROLES` even though
 * the membership currently matches: these are different decisions, and a future
 * change to who may read a run report should not silently change who may
 * contest a criterion.
 */
export const CONTESTED_WRITE_ROLES = ["OWNER", "ADMIN", "PM", "DEVELOPER"] as const;

export function canWriteContested(role: string): boolean {
  return (CONTESTED_WRITE_ROLES as readonly string[]).includes(role);
}

/** True when the caller supplied a `contested` key at all (vs. omitting it). */
export function hasContestedKey(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Object.prototype.hasOwnProperty.call(body, "contested")
  );
}

// ── Gateway rate limiting ────────────────────────────────────────────────────

const GATEWAY_RATE_LIMIT = 60;
const GATEWAY_RATE_WINDOW_SECS = 60;

/**
 * Rate limit a gateway requirement write, keyed on the API key id — the only
 * stable caller identity on these routes (an IP-keyed limit would be derived
 * from the client-controlled x-forwarded-for header).
 *
 * Returns a 429 response when the limit is exceeded, otherwise null. Fails open
 * if Redis itself errors: a limiter outage should not stop the contest agent
 * from recording a verdict.
 */
export async function checkGatewayWriteRateLimit(
  keyId: string,
  action: string,
): Promise<NextResponse | null> {
  try {
    const { allowed, retryAfter } = await checkRateLimit(
      `gateway-eval-requirements:${action}:${keyId}`,
      GATEWAY_RATE_LIMIT,
      GATEWAY_RATE_WINDOW_SECS,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
        },
      );
    }
  } catch (error) {
    console.warn("[Eval Requirement Writes] rate limiter unavailable:", error);
  }
  return null;
}
