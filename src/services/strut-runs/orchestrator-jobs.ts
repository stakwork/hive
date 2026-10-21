/**
 * The `job_turn` row for a job strut's orchestrator started inside strut
 * (`job/start`, `job/continue`; strut CALLBACKS.md §4 "A job your run
 * started"). Hive launched nothing, so no row exists for it until one is
 * minted here — found, or created, for (the orchestrator row's swarm, the
 * job's workflow, strut's run id): one row per job run, whoever gets here
 * first (the unique index on swarm + workflow + run id makes the upsert the
 * race's judge). The workflow is whichever job-shaped one the turn ran —
 * `job`, or `builder` for a workflow build (strut plans/builder-job.md §2);
 * the reply is the same shape either way. Two callers:
 *   - the orchestrator turn settling (`orchestrator-turn.ts`), which reads
 *     the jobs the turn launched from its event log and mints their rows
 *     PENDING, so the chat shows a running card while the job works. A
 *     `job/start` names its workflow; a `job/continue` does not (strut
 *     follows the job's record), so the caller reads the job's own;
 *   - the job's own `run.end`, posted to the orchestrator turn's callback
 *     (`/api/strut-runs/webhook`), which finds that row — or mints it, when
 *     the job beat the turn — and settles it. Its `workflow` is strut's
 *     word: a PENDING row of the same run minted under another workflow is
 *     re-recorded under it, so reconcile and the artifact read ask strut
 *     for the right run.
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
 * An existing row is otherwise left as it is.
 *
 * The infinite-canvas card the job is on (`input.focus`, `lib/canvas/
 * canvas-jobs.ts`) is copied onto the row so a lookup never walks back to
 * the turn: the card of the job's first turn — a job continued from
 * elsewhere stays where it started — else the orchestrator turn's.
 */

import crypto from "crypto";
import { StrutRunStatus } from "@prisma/client";
import { canvasFocusOfInput } from "@/lib/canvas/canvas-jobs";
import { db } from "@/lib/db";
import { JOB_TURN_KIND, JOB_WORKFLOW } from "@/lib/strut-jobs";
import { hashStrutRunToken } from "@/services/strut-runs";
import { firstJobTurn } from "@/services/strut-jobs";

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
  input: true,
} as const;

export type OrchestratorJobParent = {
  id: string;
  workspaceId: string;
  swarmId: string;
  userId: string;
  conversationId: string | null;
  /** Read from the row when the caller did not select it. */
  liveUpdates?: boolean;
  /** The turn's input (its canvas `focus`); read from the row when the caller did not select it. */
  input?: unknown;
};

export async function adoptOrchestratorJobRun(
  parent: OrchestratorJobParent,
  run: {
    job: string;
    runId: string;
    title: string | null;
    /** The job-shaped workflow the run is of; `job` when the caller cannot say. */
    workflow?: string;
  },
) {
  const workflow = run.workflow ?? JOB_WORKFLOW;
  const [workspace, stored, first, known] = await Promise.all([
    db.workspace.findUnique({ where: { id: parent.workspaceId }, select: { slug: true } }),
    parent.liveUpdates !== undefined && parent.input !== undefined
      ? null
      : db.strutRun.findUnique({ where: { id: parent.id }, select: { liveUpdates: true, input: true } }),
    firstJobTurn(run.job),
    db.strutRun.findMany({
      where: { swarmId: parent.swarmId, kind: JOB_TURN_KIND, jobId: run.job, strutRunId: run.runId },
      select: STRUT_RUN_WEBHOOK_SELECT,
    }),
  ]);
  const existing = known.find((r) => r.workflow === workflow) ?? known[0];
  if (existing) {
    if (existing.workflow === workflow || existing.status !== StrutRunStatus.PENDING) return existing;
    return db.strutRun.update({ where: { id: existing.id }, data: { workflow }, select: STRUT_RUN_WEBHOOK_SELECT });
  }
  const liveUpdates = parent.liveUpdates ?? stored?.liveUpdates === true;
  const focus = canvasFocusOfInput(first?.input) ?? canvasFocusOfInput(parent.input ?? stored?.input);
  const rawToken = crypto.randomBytes(32).toString("hex");
  return db.strutRun.upsert({
    where: { swarmId_workflow_strutRunId: { swarmId: parent.swarmId, workflow, strutRunId: run.runId } },
    create: {
      tokenHash: hashStrutRunToken(rawToken),
      workspaceId: parent.workspaceId,
      swarmId: parent.swarmId,
      userId: parent.userId,
      kind: JOB_TURN_KIND,
      workflow,
      strutRunId: run.runId,
      status: StrutRunStatus.PENDING,
      input: {
        prompt: "",
        title: run.title ?? run.job,
        workspace: workspace?.slug ?? "",
        via: "orchestrator",
        parentRunId: parent.id,
        ...(focus ? { focus } : {}),
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
 * The workflow a job's turns run, as hive last recorded it: its newest
 * `job_turn` row on the swarm (a job's turns all run the one workflow —
 * strut's `job/continue` follows the record). Null when hive holds none.
 */
export async function recordedJobWorkflow(swarmId: string, job: string): Promise<string | null> {
  const newest = await db.strutRun.findFirst({
    where: { swarmId, kind: JOB_TURN_KIND, jobId: job },
    orderBy: { createdAt: "desc" },
    select: { workflow: true },
  });
  return newest?.workflow ?? null;
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
): Promise<{ id: string; input: unknown } | null | "foreign"> {
  const rows = await db.strutRun.findMany({
    where: { jobId: job, kind: JOB_TURN_KIND },
    orderBy: { createdAt: "desc" },
    select: { id: true, swarmId: true, conversationId: true, strutRunId: true, status: true, input: true },
  });
  const turn =
    (runId ? rows.find((r) => r.strutRunId === runId) : undefined) ??
    rows.find((r) => r.status === StrutRunStatus.PENDING) ??
    rows[0];
  if (!turn) return null;
  if (turn.swarmId !== parent.swarmId || turn.conversationId !== parent.conversationId) return "foreign";
  return { id: turn.id, input: turn.input };
}
