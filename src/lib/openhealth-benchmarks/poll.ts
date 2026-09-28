/**
 * Poll-on-read settle path for OPENHEALTH_BENCHMARK_RUNNER rows.
 *
 * There is no cron for this feature — a settled lab run only appears once a
 * member has the Runs tab open and `GET /api/stakwork/runs` calls this.
 * Never accepts a caller-supplied lab run id or workflow name: both come
 * from server-stored state (`result.strutRunId`) and the regex-checked env
 * workflow name.
 */
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { WorkflowStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  OPENHEALTH_STRUT_WORKFLOW_NAME_RE,
  resolveOpenHealthStrutWorkflowName,
  projectOpenHealthProbeOutput,
} from "./constants";

const TERMINAL_STRUT_STATUSES: ReadonlySet<string> = new Set(["success", "error", "cancelled"]);
const POLL_TIMEOUT_MS = 10_000;

export interface OpenHealthPollableRun {
  id: string;
  status: WorkflowStatus;
  result: string | null;
}

/**
 * Probe every in-progress OPENHEALTH_BENCHMARK_RUNNER row against the
 * workspace's strut lab and settle terminal ones. Never throws — a probe
 * failure for one row is logged and simply leaves that row unsettled for
 * the next read.
 */
export async function pollOpenHealthBenchmarkRuns(
  workspaceId: string,
  rows: OpenHealthPollableRun[],
): Promise<void> {
  const pending = rows.filter(
    (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
  );
  if (pending.length === 0) return;

  const workflowName = resolveOpenHealthStrutWorkflowName();
  if (!OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test(workflowName)) return;

  let swarmResult;
  try {
    swarmResult = await getSwarmAccessByWorkspaceId(workspaceId);
  } catch {
    return;
  }
  if (!swarmResult.success) return;
  const { swarmApiKey } = swarmResult.data;
  if (!swarmApiKey) return;

  // getSwarmAccessByWorkspaceId rewrites the stored URL to
  // `https://${hostname}:3355` (dropping any path) — good enough to confirm
  // the swarm is active + get the decrypted key, but NOT the host the start
  // route posted to. Rebuild the lab base from the raw stored swarm URL with
  // the same transform the start route uses, so a hive-owned row is probed
  // on the host the start POST actually used. Do not change
  // getSwarmAccessByWorkspaceId itself — other callers depend on its rewrite.
  let rawSwarm: { swarmUrl: string | null } | null;
  try {
    rawSwarm = await db.swarm.findUnique({
      where: { workspaceId },
      select: { swarmUrl: true },
    });
  } catch {
    return;
  }
  if (!rawSwarm?.swarmUrl) return;

  const labBase = `${transformSwarmUrlToRepo2Graph(rawSwarm.swarmUrl)}/lab`;

  await Promise.all(pending.map((row) => settleOne(row, labBase, swarmApiKey, workflowName)));
}

async function settleOne(
  row: OpenHealthPollableRun,
  labBase: string,
  swarmApiKey: string,
  workflowName: string,
): Promise<void> {
  let existing: Record<string, unknown>;
  try {
    existing = row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {};
  } catch {
    return; // malformed result — can't find strutRunId, leave untouched
  }

  const strutRunId = typeof existing.strutRunId === "string" ? existing.strutRunId : undefined;
  if (!strutRunId) return;

  let res: Response;
  try {
    res = await fetch(
      `${labBase}/workflows/${encodeURIComponent(workflowName)}/runs/${encodeURIComponent(strutRunId)}`,
      {
        headers: { "x-api-token": swarmApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      },
    );
  } catch (err) {
    logger.warn("[openhealth-benchmark] poll fetch failed", "openhealth-benchmarks", {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!res.ok) return;

  let summary: { status?: unknown; partial?: unknown; output?: unknown };
  try {
    summary = (await res.json()) as typeof summary;
  } catch {
    return;
  }

  const strutStatus = typeof summary.status === "string" ? summary.status : "unknown";
  // partial:true = reconstructed from the event log — in flight or orphaned
  // by a restart. Either way, not a terminal result yet.
  if (summary.partial === true || !TERMINAL_STRUT_STATUSES.has(strutStatus)) return;

  const output =
    typeof summary.output === "object" && summary.output !== null
      ? (summary.output as Record<string, unknown>)
      : {};
  const allowlisted = projectOpenHealthProbeOutput(output);
  const f1 = allowlisted.weighted_problem_list_f1_neutral;
  const hasF1 = typeof f1 === "number" && Number.isFinite(f1);

  // A strut `error` status is FAILED. A terminal probe with no numeric F1 is
  // also FAILED (scoreError: "missing_score") — never COMPLETED without a score.
  const newStatus: WorkflowStatus =
    strutStatus === "error" || !hasF1 ? WorkflowStatus.FAILED : WorkflowStatus.COMPLETED;

  const merged: Record<string, unknown> = {
    ...existing,
    ...allowlisted,
    ...(!hasF1 ? { scoreError: "missing_score" } : {}),
  };

  try {
    await db.stakworkRun.updateMany({
      where: { id: row.id, status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] } },
      data: {
        status: newStatus,
        result: JSON.stringify(merged),
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    logger.warn("[openhealth-benchmark] settle write failed", "openhealth-benchmarks", {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  logger.info("[openhealth-benchmark] settled", "openhealth-benchmarks", {
    runId: row.id,
    task: allowlisted.task,
    gtId: allowlisted.gtId,
    labRunId: strutRunId,
    status: newStatus,
  });
}
