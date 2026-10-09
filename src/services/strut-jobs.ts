/**
 * Strut JOBS — the launch (strut `plans/jobs.md`; the tools in
 * `lib/ai/strutTools.ts`, the completion handler in
 * `strut-runs/job-turn.ts`, artifact events in
 * `strut-jobs/artifact-events.ts`).
 *
 * One turn of a job is one launch of the `job` workflow with the job id on
 * the launch (`dispatchStrutRun`; the row records `jobId`). Three doors
 * make one: Jamie's `start_job` / `continue_job`, an event about an
 * artifact the job reported (the GitHub webhook, through the artifact
 * index), and a card's action (the pull-request card's Fix). Each resolves
 * who the turn runs AS — the job's owner, whose GitHub token pushes and
 * whose delegation pays — and where the reply lands — the job's own
 * conversation — and calls `launchJobTurn`, which takes nothing of the
 * agent: the owner, the launch's workspace, the conversation, a public
 * base URL for strut to post to.
 *
 * A turn nobody asked for (`event: true`) is written into the conversation
 * as it launches — an assistant row with `source.kind: "job_event"`
 * carrying the `[artifact-event]` text (`appendJobEventRow`) — so the turn
 * has an origin where a person's words would be, the working card
 * something to hang on, and Jamie reads the event in its history.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { JOB_TURN_KIND, JOB_WORKFLOW } from "@/lib/strut-jobs";
import { cancelStrutRun, dispatchStrutRun, StrutDispatchError } from "@/services/strut-runs";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

const LOG_TAG = "STRUT_JOB";

export const BUSY_NOTE = "A turn of this job is still running. Its reply will be posted here when it ends — continue the job after that.";

export interface JobLaunchTarget {
  /** Who the turn runs as: the job's owner (`StrutRun.userId` of its first row). */
  userId: string;
  /** The launch's workspace — `StrutRun.workspaceId`, the `workspace` on the input. */
  workspaceId: string;
  /** The job's conversation: a `SharedConversation` row id the caller has checked. */
  conversationId: string;
  publicBaseUrl: string;
}

export interface JobTurnLaunch {
  jobId: string;
  title: string;
  prompt: string;
  /** `start_job`, or the next turn. */
  started: boolean;
  /** No person asked for this turn: the prompt is an `[artifact-event]`, written into the conversation as the turn's origin. */
  event?: boolean;
}

export type JobLaunchResult =
  | { status: "started" | "continued"; jobId: string; title: string; runId: string; note: string }
  | { status: "busy"; jobId: string; note: string }
  | { status: "error"; error: string };

/** The job's first turn: who started it, for which workspace, on which swarm, into which conversation. */
export async function firstJobTurn(jobId: string) {
  return db.strutRun.findFirst({
    where: { jobId, kind: JOB_TURN_KIND },
    orderBy: { createdAt: "asc" },
    select: { id: true, workspaceId: true, swarmId: true, userId: true, conversationId: true, input: true },
  });
}

/** A turn of the job is in flight — the busy guard every door checks before launching. */
export async function jobHasLiveTurn(jobId: string): Promise<boolean> {
  const live = await db.strutRun.findFirst({
    where: { jobId, kind: JOB_TURN_KIND, status: StrutRunStatus.PENDING },
    select: { id: true },
  });
  return live !== null;
}

/**
 * One turn of a job: launch the `job` workflow with the job id on the
 * launch, register it for the Stop button, write the event row when the
 * turn is an event's, and return at once — the reply lands through the
 * `job_turn` handler.
 */
export async function launchJobTurn(target: JobLaunchTarget, turn: JobTurnLaunch): Promise<JobLaunchResult> {
  const { userId, workspaceId, conversationId, publicBaseUrl } = target;
  const { jobId, title, prompt, started } = turn;

  // Where the job runs — the one policy (`strut-target.ts`), for THIS user:
  // an owner who has lost the workspace launches nothing.
  const resolved = await resolveStrutTarget({ purpose: "job", userId, workspaceId });
  if (!resolved.ok) return { status: "error", error: describeStrutTargetError(resolved.error) };
  const strut = resolved.target;

  // The user's GitHub token, pushed to strut as THIS actor's secret before
  // the launch (`dispatchStrutRun` → `ensureStrutActorSecrets`: idempotent,
  // never in `input`, never logged). Every turn, whatever it does: a turn
  // that pushes from a pod pushes as the user, and push-before-dispatch is
  // what handles rotation.
  // No token → nothing pushed; a push fails inside the run, honestly.
  let pat: string | null = null;
  try {
    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    pat = (await getGithubUsernameAndPAT(userId, strut.workspaceSlug))?.token ?? null;
  } catch (err) {
    console.warn("[job] github token lookup failed; launching without it", { jobId, error: err instanceof Error ? err.message : String(err) });
  }

  let dispatched: Awaited<ReturnType<typeof dispatchStrutRun>>;
  try {
    dispatched = await dispatchStrutRun({
      workspaceId: strut.workspaceId,
      userId,
      kind: JOB_TURN_KIND,
      workflow: JOB_WORKFLOW,
      purpose: "job",
      // `title` goes on the LAUNCH beside `job` (strut plans/job-index.md
      // §1): strut names the job by it — its index and its graph node —
      // never the run; the `job` workflow's input block strips what it
      // does not declare, so it still rides on the input too, for the
      // reply's header. `workspace` is the hive workspace the job belongs
      // to — the id a pod is claimed for (strut plans/jobs.md §5): the hub
      // strut serves every workspace of the org, so the job says which.
      // Every turn, since every launch is validated on its own.
      input: { prompt, title, workspace: strut.workspaceId },
      job: jobId,
      title,
      publicBaseUrl,
      conversationId,
      actorSecrets: { GITHUB_TOKEN: pat },
    });
  } catch (err) {
    if (err instanceof StrutDispatchError) {
      // Strut refusing the launch because the job's previous turn still
      // holds its directory is "not yet", not a failure.
      if (/\bjob_busy:/.test(err.message)) return { status: "busy", jobId, note: BUSY_NOTE };
      console.warn("[job] dispatch refused", { jobId, code: err.code });
      return {
        status: "error",
        error:
          err.code === "workflow_missing"
            ? "This swarm's strut has no `job` workflow yet (its lab is not on a build that seeds it). Tell the user; a workspace admin updates the swarm."
            : err.message,
      };
    }
    console.error("[job] dispatch failed", { jobId, error: err instanceof Error ? err.message : String(err) });
    return { status: "error", error: "The job turn could not be started." };
  }

  // The Stop button: register the run (keyed by the StrutRun id) so Stop
  // cancels it on strut. A Stop that landed before this registration
  // (pending-abort intent for this turn) cancels it right away.
  try {
    const { setActiveRun, notifyRunActive } = await import("@/services/canvas-active-runs-hooks");
    const { abortSelf } = await setActiveRun(
      conversationId,
      { requestId: dispatched.runId, workspaceId: strut.workspaceId, startedAt: new Date().toISOString() },
      dispatched.runId, // turnId fallback
    );
    if (abortSelf) {
      await cancelStrutRun({ id: dispatched.runId, swarmId: dispatched.swarmId, workflow: JOB_WORKFLOW, strutRunId: dispatched.strutRunId });
    }
    await notifyRunActive(conversationId, true);
  } catch (err) {
    console.warn("[job] active-run registration failed (non-fatal)", {
      runId: dispatched.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // The turn's origin, once strut has it: the event where a person's words
  // would be, the anchor the working card hangs on until the job row lands
  // (`getPendingJobTurnsFromMessages`). After the dispatch, so a refused
  // launch leaves no card waiting on a turn that never started.
  if (turn.event) {
    try {
      const { appendJobEventRow } = await import("@/services/strut-runs/job-turn");
      await appendJobEventRow(
        { id: dispatched.runId, workspaceId: strut.workspaceId, userId, conversationId },
        { content: prompt, source: { kind: "job_event", jobId, title, runId: dispatched.runId } },
      );
    } catch (err) {
      logger.warn("Job event row not written (non-fatal)", LOG_TAG, { jobId, runId: dispatched.runId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info("Job turn dispatched", LOG_TAG, { jobId, runId: dispatched.runId, strutRunId: dispatched.strutRunId, started, event: turn.event === true });
  return {
    status: started ? "started" : "continued",
    jobId,
    title,
    runId: dispatched.runId,
    note:
      "Strut is working on it in the background. The reply — and what it produced, as artifact cards — lands in this conversation as a **Job** entry; " +
      "tell the user it's underway and stop. Do not call this tool again for the same request.",
  };
}
