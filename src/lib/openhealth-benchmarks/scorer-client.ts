/**
 * Client for the OpenHealth swarm scorer's read-only instance list.
 *
 * There is no Hive client and no graph node for this list — it must be read
 * from the swarm scorer directly (`GET /score/instances`), token-gated with
 * `X-Scorer-Token` (the workspace swarm key). Do NOT call `openhealth/load-task`
 * (it returns `groundTruth`) and do NOT open `benchmark_v1.3.db` directly.
 */
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
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

/** `{repo2graph}` — the same host strut's lab is mounted on, scorer's own mount point. */
function scorerBaseUrl(swarmUrl: string): string {
  return transformSwarmUrlToRepo2Graph(swarmUrl);
}

/**
 * Fetch a page of public/heldout instance metadata from the swarm scorer.
 * `split` and `task` are bound as query parameters — never interpolated into
 * a SQL or Cypher string. Callers must validate `split`/`task` before calling.
 */
export async function fetchOpenHealthInstances(
  swarmUrl: string,
  swarmApiKey: string,
  params: {
    split: OpenHealthSplit;
    task?: OpenHealthTaskName;
    limit: number;
    offset?: number;
  },
): Promise<OpenHealthInstanceListResult> {
  const url = new URL(`${scorerBaseUrl(swarmUrl)}/score/instances`);
  url.searchParams.set("split", params.split);
  if (params.task) url.searchParams.set("task", params.task);
  url.searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-Scorer-Token": swarmApiKey },
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
