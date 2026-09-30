/**
 * Strut's workflow catalog (`GET {lab}/workflows?q=`) — the authoritative
 * list of workflows a Strut target can run, and the source of truth for
 * validating structured `@workflow` mentions typed into Jamie chat
 * (`services/strut-target.ts` resolves WHICH strut; this reads its
 * catalog).
 *
 * The workflow's `name` IS its stable identifier (it's what
 * `dispatchStrutRun` puts in `/workflows/${encodeURIComponent(workflow)}/run`
 * — see `strut-runs.ts`). This module normalizes every upstream record to
 * `{ id, name }` with `id === name`, so callers never see strut's other
 * fields (category, description, lastRunAt) — keeping the mention surface
 * minimal and independent of strut's schema evolving.
 *
 * `GET /workflows` on strut returns the FULL list with no pagination
 * (`createStrut.ts`'s `app.get("/workflows")`), so every read here is
 * bounded defensively — response byte size, entry count, id/name length —
 * and fails CLOSED (throws) rather than silently validating a mention
 * against a truncated catalog.
 *
 * NEVER log the swarm API key, actor, or labBase; NEVER return them (or
 * any other upstream field) to a caller.
 */

import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import type { StrutTarget } from "@/services/strut-target";

/** What `listStrutWorkflows` / `validateWorkflowMentions` need from a `StrutTarget`. */
export type StrutWorkflowsCredentials = Pick<StrutTarget, "labBase" | "swarmApiKey" | "actor">;

const CATALOG_TIMEOUT_MS = 5_000;
/** Hard cap on suggestions returned to the composer dropdown. */
export const MAX_WORKFLOW_SUGGESTIONS = 5;
export const MAX_WORKFLOW_ID_LEN = 128;
export const MAX_WORKFLOW_NAME_LEN = 200;
export const MAX_WORKFLOW_QUERY_LEN = 100;
/** Fail closed rather than validate against a silently truncated catalog. */
const MAX_CATALOG_RESPONSE_BYTES = 2_000_000;
const MAX_CATALOG_ENTRIES = 5_000;
/** Per `/api/ask/quick` send — matches the checklist's bound. */
export const MAX_WORKFLOW_MENTION_OCCURRENCES = 20;

export interface StrutWorkflowSummary {
  /** = strut's workflow `name` — the stable identifier callers submit back. */
  id: string;
  name: string;
}

export type StrutWorkflowCatalogFailure = "timeout" | "upstream" | "malformed" | "too_large";

export class StrutWorkflowCatalogError extends Error {
  readonly type: StrutWorkflowCatalogFailure;
  constructor(type: StrutWorkflowCatalogFailure, message: string) {
    super(message);
    this.name = "StrutWorkflowCatalogError";
    this.type = type;
  }
}

function normalizeEntry(raw: unknown): StrutWorkflowSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const name = (raw as Record<string, unknown>).name;
  if (typeof name !== "string" || !name) return null;
  if (name.length > MAX_WORKFLOW_NAME_LEN || name.length > MAX_WORKFLOW_ID_LEN) return null;
  return { id: name, name };
}

/**
 * Fetch the authorized target's workflow catalog, optionally filtered
 * upstream by `q`. Bounded and fail-closed: a response over-size, over-
 * count, unparsable, or non-array throws rather than returning a partial
 * list — callers (suggestion search, mention validation) must never treat
 * a truncated read as "this workflow doesn't exist."
 */
export async function listStrutWorkflows(
  target: StrutWorkflowsCredentials,
  opts: { q?: string } = {},
): Promise<StrutWorkflowSummary[]> {
  const q = (opts.q ?? "").slice(0, MAX_WORKFLOW_QUERY_LEN);
  const url = new URL(`${target.labBase}/workflows`);
  if (q) url.searchParams.set("q", q);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "x-api-token": target.swarmApiKey,
        [STRUT_ACTOR_HEADER]: target.actor,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    throw new StrutWorkflowCatalogError(
      isTimeout ? "timeout" : "upstream",
      isTimeout ? "Strut workflow catalog timed out" : "Strut workflow catalog unreachable",
    );
  }

  if (!res.ok) {
    throw new StrutWorkflowCatalogError("upstream", `Strut workflow catalog responded ${res.status}`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_CATALOG_RESPONSE_BYTES) {
    throw new StrutWorkflowCatalogError("too_large", "Strut workflow catalog response exceeded the size bound");
  }

  const text = await res.text();
  if (text.length > MAX_CATALOG_RESPONSE_BYTES) {
    throw new StrutWorkflowCatalogError("too_large", "Strut workflow catalog response exceeded the size bound");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StrutWorkflowCatalogError("malformed", "Strut workflow catalog returned malformed JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new StrutWorkflowCatalogError("malformed", "Strut workflow catalog did not return an array");
  }
  if (parsed.length > MAX_CATALOG_ENTRIES) {
    throw new StrutWorkflowCatalogError("too_large", "Strut workflow catalog returned too many entries");
  }

  const out: StrutWorkflowSummary[] = [];
  for (const raw of parsed) {
    const entry = normalizeEntry(raw);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Bounded, server-filtered suggestions for the `@` mention dropdown.
 * Prefers upstream `?q=` filtering; also filters locally (case-
 * insensitive substring) in case the confirmed upstream contract doesn't
 * filter server-side, then caps at `MAX_WORKFLOW_SUGGESTIONS`.
 */
export async function searchStrutWorkflows(
  target: StrutWorkflowsCredentials,
  q: string,
): Promise<StrutWorkflowSummary[]> {
  const bounded = q.slice(0, MAX_WORKFLOW_QUERY_LEN);
  const catalog = await listStrutWorkflows(target, { q: bounded });
  const needle = bounded.trim().toLowerCase();
  const filtered = needle ? catalog.filter((w) => w.name.toLowerCase().includes(needle)) : catalog;
  return filtered.slice(0, MAX_WORKFLOW_SUGGESTIONS);
}

/** Shape the client submits for one `@workflow` occurrence in a send. */
export interface WorkflowMentionInput {
  id: string;
  name: string;
  start: number;
  end: number;
}

export type WorkflowMentionErrorCode =
  | "WORKFLOW_MENTION_MALFORMED"
  | "WORKFLOW_MENTION_TOO_MANY"
  | "WORKFLOW_MENTION_INVALID"
  | "WORKFLOW_MENTION_UPSTREAM_ERROR";

export class WorkflowMentionValidationError extends Error {
  readonly code: WorkflowMentionErrorCode;
  constructor(code: WorkflowMentionErrorCode, message: string) {
    super(message);
    this.name = "WorkflowMentionValidationError";
    this.code = code;
  }
}

function isValidMentionShape(m: unknown): m is WorkflowMentionInput {
  if (!m || typeof m !== "object") return false;
  const r = m as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= MAX_WORKFLOW_ID_LEN &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    r.name.length <= MAX_WORKFLOW_NAME_LEN &&
    typeof r.start === "number" &&
    Number.isInteger(r.start) &&
    r.start >= 0 &&
    typeof r.end === "number" &&
    Number.isInteger(r.end) &&
    r.end > r.start
  );
}

/**
 * Re-validate every submitted workflow mention against the authorized
 * target's LIVE catalog, fetched exactly once. A reference absent from
 * this authorized catalog is invalid regardless of whether it's stale,
 * fabricated, or belongs to another org — there is no cross-org probe;
 * the catalog IS the authorization boundary.
 *
 * Repeated occurrences of the same id are accepted (deduped for the
 * lookup); the return value is the deduplicated set of canonical
 * `{id,name}` records — client-submitted `name`/`start`/`end` are never
 * trusted past shape validation.
 *
 * Throws `WorkflowMentionValidationError` with a stable `code` on any
 * malformed, oversized, or unauthorized reference. Throws
 * `StrutWorkflowCatalogError` (wrapped as `WORKFLOW_MENTION_UPSTREAM_ERROR`)
 * when the catalog itself can't be read.
 */
export async function validateWorkflowMentions(
  target: StrutWorkflowsCredentials,
  mentions: unknown,
): Promise<StrutWorkflowSummary[]> {
  if (mentions === undefined || mentions === null) return [];
  if (!Array.isArray(mentions)) {
    throw new WorkflowMentionValidationError("WORKFLOW_MENTION_MALFORMED", "workflowMentions must be an array");
  }
  if (mentions.length === 0) return [];
  if (mentions.length > MAX_WORKFLOW_MENTION_OCCURRENCES) {
    throw new WorkflowMentionValidationError(
      "WORKFLOW_MENTION_TOO_MANY",
      `At most ${MAX_WORKFLOW_MENTION_OCCURRENCES} workflow mentions are allowed per message`,
    );
  }
  for (const m of mentions) {
    if (!isValidMentionShape(m)) {
      throw new WorkflowMentionValidationError("WORKFLOW_MENTION_MALFORMED", "A workflow mention is malformed");
    }
    if (m.end - m.start !== m.name.length) {
      throw new WorkflowMentionValidationError(
        "WORKFLOW_MENTION_MALFORMED",
        "A workflow mention's range does not match its display name",
      );
    }
  }

  let catalog: StrutWorkflowSummary[];
  try {
    catalog = await listStrutWorkflows(target, {});
  } catch (err) {
    if (err instanceof StrutWorkflowCatalogError) {
      throw new WorkflowMentionValidationError(
        "WORKFLOW_MENTION_UPSTREAM_ERROR",
        "Could not verify workflow references right now",
      );
    }
    throw err;
  }
  const byId = new Map(catalog.map((w) => [w.id, w]));

  const canonicalById = new Map<string, StrutWorkflowSummary>();
  for (const m of mentions as WorkflowMentionInput[]) {
    const canonical = byId.get(m.id);
    if (!canonical) {
      throw new WorkflowMentionValidationError(
        "WORKFLOW_MENTION_INVALID",
        "One or more referenced workflows are not available",
      );
    }
    canonicalById.set(m.id, canonical);
  }
  return Array.from(canonicalById.values());
}
