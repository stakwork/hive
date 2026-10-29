/**
 * Keep a swarm's Jarvis schema in step before a strut run that may write to
 * its graph. Runs the existing `swarm-systemmap-schema-sync` workflow (with
 * widened params) on the target swarm, awaited with a bounded timeout, at
 * most once an hour per swarm.
 *
 * Never throws and never blocks a launch for longer than the timeout: any
 * failure is logged and the launch proceeds. No timestamp is recorded on
 * failure, so the next launch retries.
 *
 * State is an in-memory Map (hive is serverless-ish; a cold instance just
 * re-syncs, which is idempotent) — deliberately no DB column / migration.
 */

import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { JOB_WORKFLOW } from "@/lib/strut-jobs";
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import { STRUT_RUN_LOG_TAG } from "@/services/strut-runs";
import type { StrutTarget } from "@/services/strut-target";

export const SCHEMA_SYNC_WORKFLOW = "swarm-systemmap-schema-sync";

export const SCHEMA_SYNC_PARAMS = {
  ontology_domains: "SystemMap,CodeArtifact,Infosec,Epistemic",
  include_types: [
    "Actor",
    "Finding",
    "SecurityTest",
    "SecurityAssessment",
    "SecurityObservation",
    "Claim",
    "Evidence",
    "Check",
  ],
  apply_modifications: false,
  allow_structural_changes: false,
  removal_policy: "report",
} as const;

export const SCHEMA_SYNC_TTL_MS = 60 * 60 * 1000;
export const SCHEMA_SYNC_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["success", "error", "cancelled"]);

/**
 * Workflows that may write to (or start work that writes to) a swarm graph.
 * The system-map names mirror `SYSTEM_MAP_WORKFLOWS` (literals here: that
 * module imports strut-runs, which imports this one).
 */
const SCHEMA_SYNC_WORKFLOWS: ReadonlySet<string> = new Set([
  JOB_WORKFLOW,
  "builder",
  "orchestrator", // starts jobs
  "swarm-systemmap",
  "swarm-security-hunt",
  "finding-verify-pod-batch",
  "swarm-package-cve-findings",
  "swarm-systemmap-cwe-check-templates",
]);

export function shouldSyncSchemaFor(workflow: string): boolean {
  return workflow !== SCHEMA_SYNC_WORKFLOW && SCHEMA_SYNC_WORKFLOWS.has(workflow);
}

const lastSynced = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Test-only: clear the in-memory state. */
export function resetSwarmSchemaSyncState(): void {
  lastSynced.clear();
  inFlight.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSync(target: StrutTarget, deadline: number): Promise<boolean> {
  const swarm = await db.swarm.findUnique({
    where: { id: target.swarmId },
    select: { swarmSecretAlias: true },
  });
  if (!swarm?.swarmSecretAlias) {
    logger.info("Schema sync skipped: swarm has no secret alias", STRUT_RUN_LOG_TAG, { swarmId: target.swarmId });
    return false;
  }
  const headers = {
    "Content-Type": "application/json",
    "x-api-token": target.swarmApiKey,
    [STRUT_ACTOR_HEADER]: target.actor,
  };
  const base = `${target.labBase}/workflows/${encodeURIComponent(SCHEMA_SYNC_WORKFLOW)}`;
  const left = () => Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));

  const res = await fetch(`${base}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { swarm_url: target.mcpBase, swarm_secret_alias: swarm.swarmSecretAlias },
      params: SCHEMA_SYNC_PARAMS,
    }),
    signal: AbortSignal.timeout(left()),
  });
  if (!res.ok) throw new Error(`launch HTTP ${res.status}`);
  const launched = (await res.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = launched?.runId;
  if (typeof runId !== "string" && typeof runId !== "number") throw new Error("launch returned no run id");

  while (Date.now() < deadline) {
    const poll = await fetch(`${base}/runs/${encodeURIComponent(String(runId))}`, {
      headers: { "x-api-token": target.swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(left()),
    });
    if (poll.ok) {
      const summary = (await poll.json()) as { status?: unknown; partial?: unknown };
      const status = typeof summary.status === "string" ? summary.status : "unknown";
      if (summary.partial !== true && TERMINAL_STATUSES.has(status)) {
        if (status !== "success") throw new Error(`schema sync run ended ${status}`);
        return true;
      }
    } else if (poll.status === 404) {
      throw new Error("schema sync run not found");
    }
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
  throw new Error("schema sync timed out");
}

/** Sync the swarm's Jarvis schema if `workflow` may write to the graph and it is stale. Never throws. */
export async function ensureSwarmSchemaSynced(target: StrutTarget, workflow: string): Promise<void> {
  try {
    if (!shouldSyncSchemaFor(workflow)) return;
    const { swarmId } = target;
    const last = lastSynced.get(swarmId);
    if (last !== undefined && Date.now() - last < SCHEMA_SYNC_TTL_MS) return;

    const existing = inFlight.get(swarmId);
    if (existing) return await existing;

    const p = (async () => {
      try {
        const ok = await runSync(target, Date.now() + SCHEMA_SYNC_TIMEOUT_MS);
        if (ok) {
          lastSynced.set(swarmId, Date.now());
          logger.info("Swarm schema synced", STRUT_RUN_LOG_TAG, { swarmId, workflow });
        }
      } catch (err) {
        logger.warn("Swarm schema sync failed (non-fatal)", STRUT_RUN_LOG_TAG, {
          swarmId,
          workflow,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inFlight.delete(swarmId);
      }
    })();
    inFlight.set(swarmId, p);
    await p;
  } catch (err) {
    logger.warn("Swarm schema sync errored (non-fatal)", STRUT_RUN_LOG_TAG, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
