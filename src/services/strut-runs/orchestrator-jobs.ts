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
 * strut posts to the orchestrator's. An existing row is left as it is.
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
} as const;

export type OrchestratorJobParent = {
  id: string;
  workspaceId: string;
  swarmId: string;
  userId: string;
  conversationId: string | null;
};

export async function adoptOrchestratorJobRun(
  parent: OrchestratorJobParent,
  run: { job: string; runId: string; title: string | null },
) {
  const workspace = await db.workspace.findUnique({ where: { id: parent.workspaceId }, select: { slug: true } });
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
    },
    update: {},
    select: STRUT_RUN_WEBHOOK_SELECT,
  });
}
