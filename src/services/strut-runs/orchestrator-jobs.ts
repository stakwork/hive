/**
 * The `job_turn` row for a job strut's orchestrator started inside strut
 * (`job/start`, `job/continue`; strut CALLBACKS.md §4 "A job your run
 * started"). Hive launched nothing, so no row exists for it until one is
 * minted here — found, or created, for (the orchestrator row's swarm,
 * `job`, strut's run id): one row per job run, whoever gets here first
 * (the unique index on swarm + workflow + run id makes the upsert the
 * race's judge). Two callers:
 *   - the orchestrator turn settling (`orchestrator-turn.ts`), which reads
 *     the jobs the turn launched from its event log and mints their rows
 *     PENDING, so the chat shows a running card while the job works;
 *   - the job's own `run.end`, posted to the orchestrator turn's callback
 *     (`/api/strut-runs/webhook`), which finds that row — or mints it, when
 *     the job beat the turn — and settles it.
 *
 * Everything that routes the reply is the ORCHESTRATOR row's — workspace,
 * user, swarm, conversation; the job id and the run id are strut's. The
 * input is a hive launch's shape (`jobTurnInputSchema`) with an empty
 * prompt, `via: "orchestrator"` (the wake goes to the orchestrator, not the
 * canvas agent) and the orchestrator row as `parentRunId`. The token is
 * fresh and thrown away: nothing will ever call this row's URL, since
 * strut posts to the orchestrator's. `liveUpdates` is the orchestrator
 * row's: a turn whose launch strut honored `jobCallback` on hands that URL
 * to the jobs it starts (strut CALLBACKS.md §5), so their live updates
 * reach `/api/strut-jobs/events` and the claims card's Verify may detach.
 * An existing row is left as it is.
 */

import crypto from "crypto";
import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { JOB_TURN_KIND, JOB_WORKFLOW } from "@/lib/strut-jobs";
import { hashStrutRunToken } from "@/services/strut-runs";

/** What the strut-runs webhook reads of a row (and what an adopted row is returned as). */
export const STRUT_RUN_WEBHOOK_SELECT = {
  id: true,
  tokenHash: true,
  status: true,
  workflow: true,
  strutRunId: true,
  kind: true,
  workspaceId: true,
  swarmId: true,
  userId: true,
  conversationId: true,
  liveUpdates: true,
} as const;

export type OrchestratorJobParent = {
  id: string;
  workspaceId: string;
  swarmId: string;
  userId: string;
  conversationId: string | null;
  /** Read from the row when the caller did not select it. */
  liveUpdates?: boolean;
};

export async function adoptOrchestratorJobRun(
  parent: OrchestratorJobParent,
  run: { job: string; runId: string; title: string | null },
) {
  const [workspace, liveUpdates] = await Promise.all([
    db.workspace.findUnique({ where: { id: parent.workspaceId }, select: { slug: true } }),
    parent.liveUpdates ??
      db.strutRun
        .findUnique({ where: { id: parent.id }, select: { liveUpdates: true } })
        .then((r) => r?.liveUpdates === true),
  ]);
  const rawToken = crypto.randomBytes(32).toString("hex");
  return db.strutRun.upsert({
    where: { swarmId_workflow_strutRunId: { swarmId: parent.swarmId, workflow: JOB_WORKFLOW, strutRunId: run.runId } },
    create: {
      tokenHash: hashStrutRunToken(rawToken),
      workspaceId: parent.workspaceId,
      swarmId: parent.swarmId,
      userId: parent.userId,
      kind: JOB_TURN_KIND,
      workflow: JOB_WORKFLOW,
      strutRunId: run.runId,
      status: StrutRunStatus.PENDING,
      input: {
        prompt: "",
        title: run.title ?? run.job,
        workspace: workspace?.slug ?? "",
        via: "orchestrator",
        parentRunId: parent.id,
      },
      conversationId: parent.conversationId,
      jobId: run.job,
      liveUpdates,
    },
    update: {},
    select: STRUT_RUN_WEBHOOK_SELECT,
  });
}

/**
 * The `job_turn` row a live update is about, for an event posted to an
 * orchestrator turn's shared `jobCallback` (strut CALLBACKS.md §5: every
 * job the turn starts inherits ONE URL, so the payload names the job and
 * its run). `runId` picks the row for (job, run). Without one (a hold let
 * go by a delete or the idle sweep), or before that row is minted — the
 * orchestrator's event log is read when ITS run settles, and a job reports
 * from its first step — the job's newest PENDING row, else its newest.
 *
 *   - `null`: no row of the job yet. The caller forwards by job id alone:
 *     the update goes to the token's own conversation and nowhere else.
 *   - `"foreign"`: the job's row is another conversation's (or another
 *     swarm's) — the token does not vouch for it.
 */
export async function orchestratorJobTurnFor(
  parent: Pick<OrchestratorJobParent, "swarmId" | "conversationId">,
  job: string,
  runId?: string,
): Promise<{ id: string } | null | "foreign"> {
  const rows = await db.strutRun.findMany({
    where: { jobId: job, kind: JOB_TURN_KIND },
    orderBy: { createdAt: "desc" },
    select: { id: true, swarmId: true, conversationId: true, strutRunId: true, status: true },
  });
  const turn =
    (runId ? rows.find((r) => r.strutRunId === runId) : undefined) ??
    rows.find((r) => r.status === StrutRunStatus.PENDING) ??
    rows[0];
  if (!turn) return null;
  if (turn.swarmId !== parent.swarmId || turn.conversationId !== parent.conversationId) return "foreign";
  return { id: turn.id };
}
