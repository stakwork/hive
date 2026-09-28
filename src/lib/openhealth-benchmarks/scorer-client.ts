/**
 * Client for the OpenHealth scorer's read-only instance list.
 *
 * The scorer is the `synthetic_hospital` epic_sim app — it is NOT the
 * workspace swarm on port 3355 and is not reached via `transformSwarmUrlToRepo2Graph`.
 * There is no Hive client and no graph node for this list — it must be read
 * from the scorer directly (`GET /score/instances`), token-gated with
 * `X-Scorer-Token` (the epic_sim `EPIC_SIM_SCORER_TOKEN`, configured here via
 * `OPENHEALTH_SCORER_TOKEN`). Do NOT call `openhealth/load-task`
 * (it returns `groundTruth`) and do NOT open `benchmark_v1.3.db` directly.
 */
import type { OpenHealthSplit, OpenHealthTaskName } from "./constants";

/** Row shape returned by the scorer's `/score/instances` endpoint. */
export interface OpenHealthInstanceSummary {
  gt_id: string;
  task: string;
  granularity: string | null;
  split: string;
  patient_id: string | null;
  encounter_id: string | null;
  difficulty: string | null;
  variant?: string | null;
  clinical_question?: string | null;
  specialty?: string | null;
  // Any other field (ground_truth, groundTruth, gold, ...) is dropped by the
  // caller's allowlist projection — this interface intentionally does not
  // widen to `Record<string, unknown>` to keep the contract narrow.
  [key: string]: unknown;
}

export interface OpenHealthInstanceListResult {
  rows: OpenHealthInstanceSummary[];
  total?: number;
}

const SCORER_TIMEOUT_MS = 15_000;

/** Scorer base URL + token, sourced from env. Null when either is unset. */
export interface OpenHealthScorerConfig {
  baseUrl: string;
  token: string;
}

/**
 * Read the OpenHealth scorer's base URL and token from env.
 * `OPENHEALTH_SCORER_URL` — the `synthetic_hospital` epic_sim app's base URL
 * (trailing slash trimmed). `OPENHEALTH_SCORER_TOKEN` — the epic_sim
 * `EPIC_SIM_SCORER_TOKEN` value. Returns null when either is missing.
 */
export function getOpenHealthScorerConfig(): OpenHealthScorerConfig | null {
  const rawBaseUrl = process.env.OPENHEALTH_SCORER_URL;
  const token = process.env.OPENHEALTH_SCORER_TOKEN;
  if (!rawBaseUrl || !token) return null;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  return { baseUrl, token };
}

/**
 * Fetch a page of public/heldout instance metadata from the OpenHealth scorer.
 * `split` and `task` are bound as query parameters — never interpolated into
 * a SQL or Cypher string. Callers must validate `split`/`task` before calling.
 */
export async function fetchOpenHealthInstances(
  config: OpenHealthScorerConfig,
  params: {
    split: OpenHealthSplit;
    task?: OpenHealthTaskName;
    limit: number;
    offset?: number;
  },
): Promise<OpenHealthInstanceListResult> {
  const url = new URL(`${config.baseUrl}/score/instances`);
  url.searchParams.set("split", params.split);
  if (params.task) url.searchParams.set("task", params.task);
  url.searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-Scorer-Token": config.token },
    cache: "no-store",
    signal: AbortSignal.timeout(SCORER_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Scorer instance list failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as unknown;
  if (Array.isArray(body)) {
    return { rows: body as OpenHealthInstanceSummary[] };
  }
  const obj = (body ?? {}) as { rows?: unknown; instances?: unknown; total?: unknown };
  const rows = Array.isArray(obj.rows)
    ? (obj.rows as OpenHealthInstanceSummary[])
    : Array.isArray(obj.instances)
      ? (obj.instances as OpenHealthInstanceSummary[])
      : [];
  return {
    rows,
    total: typeof obj.total === "number" ? obj.total : undefined,
  };
}
