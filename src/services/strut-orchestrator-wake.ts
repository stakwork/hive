/**
 * The wake of a job turn — hive wakes strut's orchestrator, the engine
 * behind Jamie (`docs/jamie-engine.md`), on the conversation the job
 * replies into.
 *
 * A job reaches a conversation two ways: the orchestrator started it
 * inside strut (`job/start`), and the job's `run.end` reaches hive under
 * the orchestrator turn's callback, where the strut-runs webhook adopts it
 * as a `job_turn` row (`via: "orchestrator"` on its input); or hive
 * launched the turn itself — a card's action, an event about an artifact
 * the job reported, a job an older conversation started. Either way the
 * row lands in the conversation as the collapsed record with its cards,
 * and this is where the readable part comes from: one turn of the
 * orchestrator on the same conversation and session, launched by
 * `launchOrchestratorTurn` with a wake prompt in place of a person's
 * message. Its reply lands as a normal orchestrator row.
 *
 * The prompt carries the job's reply INLINE: the orchestrator sees only
 * its own session, never hive's rows, so the text it is reacting to (capped),
 * the question the job asked and the cards the user can already see are
 * in the message; `job/get` is named for the full record. It decides one of
 * summarize (the default), continue through its own `job/continue`, or
 * stay silent — and silence is a text convention,
 * `ORCHESTRATOR_SILENT_MARKER`, since the orchestrator has no tool hive
 * could watch (the handler turns it into a `silent` row the chat hides).
 *
 * Gated through `runGatedAutoTurn` (`canvas-strut-autoturn.ts`): kill
 * switch, claim, idempotency (here the launch marker that carries this
 * wake's id) and the loop breaker, which here counts job rows since the
 * last human message (`countTrailingJobRows`): continue → the job lands →
 * wake → continue → … stops at `MAX_CONSECUTIVE_STRUT_DISPATCHES` rounds.
 * No opt-in: without the wake the orchestrator never sees the job's reply
 * or its question, and the person's "ok, do it" would reach an agent that
 * never saw what was asked.
 *
 * Busy is "not yet", never a notice. The session takes one turn at a time
 * — a person's message in flight, or the orchestrator turn that started
 * the job still ending (a job that fails at once) — so a busy launch is
 * retried a bounded number of times inside the callback's after-response
 * budget, then dropped with a log: the orchestrator reads the job back
 * through `job/get` on its next turn anyway.
 *
 * Where the conversation is read — a voice call, a Sphinx tribe — the
 * person's own turns tell the launch (`call`, `tribe`); a wake has no
 * person, so it reads it off the conversation (`conversationMedium`) and
 * passes the same, so the summary is written for the room the question was
 * asked in — a tribe's as a text message, not a page.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { describeArtifactEvent, type ArtifactEvent } from "@/lib/strut-jobs";
import { ORCHESTRATOR_SILENT_MARKER, countTrailingJobRows } from "@/lib/strut-orchestrator";
import { runGatedAutoTurn, type JobWakeOutcome } from "@/services/canvas-strut-autoturn";
import {
  launchOrchestratorTurn,
  type OrchestratorLaunchResult,
  type OrchestratorTurnArgs,
} from "@/services/strut-orchestrator";

const LOG_TAG = "ORCHESTRATOR_WAKE";

/** Cap on the job's reply text carried in the prompt. */
export const MAX_WAKE_TEXT_CHARS = 6_000;

/**
 * Waits between busy launches. Three attempts over ~30 s: the strut-runs
 * webhook gives its after-response work 60 s (`maxDuration`), and a
 * person's turn or the launching turn's own end is usually seconds away.
 */
export const ORCHESTRATOR_WAKE_RETRY_DELAYS_MS: readonly number[] = [15_000, 15_000];

export interface OrchestratorJobWakeArgs {
  /** `SharedConversation.id` the job replies into. */
  conversationId: string;
  /** The job row's id (`job-<StrutRun.id>`) — the claim + idempotency key. */
  wakeId: string;
  workspaceSlug: string;
  jobId: string;
  title: string;
  outcome: JobWakeOutcome;
  /** The job's reply as the row says it (`replyForRow`), inlined for the orchestrator. */
  text: string;
  /** The job's agent stopped for a decision: its question. */
  ask?: string;
  /** What landed on the row as cards — what the user can already see. */
  artifacts: Array<{ title: string; kind: string; label?: string }>;
  publicBaseUrl: string;
  /** The turn was started by hive for an event about an artifact the job reported — not by the orchestrator, not by the user. */
  event?: ArtifactEvent;
  /**
   * The orchestrator started the job (`via: "orchestrator"` on the row).
   * Otherwise hive did — a card, or a conversation from before Jamie ran
   * on strut — and the prompt does not say "which you started".
   */
  startedByOrchestrator: boolean;
}

/** What the wake launches with — injectable so the retry is testable without the clock. */
export interface OrchestratorWakeDeps {
  launch: (args: OrchestratorTurnArgs) => Promise<OrchestratorLaunchResult>;
  sleep: (ms: number) => Promise<void>;
  retryDelaysMs: readonly number[];
}

const defaultDeps: OrchestratorWakeDeps = {
  launch: launchOrchestratorTurn,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryDelaysMs: ORCHESTRATOR_WAKE_RETRY_DELAYS_MS,
};

const cap = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** How the job turn ended, as the prompt says it. */
function describeOutcome(args: OrchestratorJobWakeArgs): string {
  switch (args.outcome) {
    case "success":
      return args.ask ? "finished its turn and STOPPED FOR A DECISION (its question is below)" : "finished its turn";
    case "error":
      return "failed (its reply says why)";
    case "cancelled":
      return "been stopped by the user";
    case "lost":
      return "been lost: strut restarted before recording it, so its prompt would have to be sent again";
  }
}

/** The job's reply and cards, as the prompt carries them. Pure. */
function renderJobReply(args: OrchestratorJobWakeArgs): string {
  const cards =
    args.artifacts.length > 0
      ? "What it produced is attached to that entry as cards the user can open: " +
        args.artifacts.map((a) => `${a.title} (${a.label ?? a.kind})`).join(", ") +
        "."
      : "Nothing is attached to it.";
  const text = args.text.trim() ? cap(args.text.trim(), MAX_WAKE_TEXT_CHARS) : "(no reply text)";
  return (
    `${cards}\n\n` +
    "Its reply, verbatim:\n" +
    "<<<job reply\n" +
    `${text}\n` +
    ">>>\n" +
    (args.ask ? `\nIts question for the user: ${args.ask}\n` : "")
  );
}

/**
 * The wake prompt — modeled on the canvas agent's job wake
 * (`buildJobWakeMessage`), with the job's reply inline and the
 * orchestrator's own means: `job/continue`, `job/get`, and the silent
 * marker in place of a tool. Pure.
 */
export function buildOrchestratorJobWakeText(args: OrchestratorJobWakeArgs): string {
  if (args.event) return buildEventWakeText(args, args.event);
  return (
    `You were invoked because job \`${args.jobId}\` ("${args.title}") on workspace \`${args.workspaceSlug}\` ` +
    `— ${args.startedByOrchestrator ? "which you started with job/start" : "which was started from this conversation"} — has ${describeOutcome(args)}. ` +
    "Hive has already written the job's entry into this conversation for the user, COLLAPSED: it is written in detail " +
    "(a code change lists files, functions and line numbers) and the user expands it only to check. Your reply is what they read. " +
    `${renderJobReply(args)}\n` +
    "Follow the user's standing instructions in this conversation. Decide one of:\n" +
    "- **Summarize** (the default): write one short paragraph in your own words — what the job produced, the question it asked if it asked one, " +
    "and the next step. Do not restate the entry, do not list files, functions or line numbers, and do not describe the cards — the user sees them.\n" +
    `- **Continue:** call job/continue with job \`${args.jobId}\` — ONLY when the user's request is not yet met and the next step ` +
    "is clearly within what they asked for (the job's question is one their instructions already answer, or they asked for a result this turn did not reach). " +
    "Say in one line that you did.\n" +
    `- **Stay silent:** reply with exactly \`${ORCHESTRATOR_SILENT_MARKER}\` and nothing else when there is nothing to add — ` +
    "the user stopped the turn themselves, or the entry is one line that says it all.\n\n" +
    "job/get has the full record if you need more than the reply above. " +
    "Default toward a summary. A job runs real code on the swarm; never widen the task on your own."
  );
}

/**
 * The wake for a turn an EVENT started (strut plans/job-artifact-events.md
 * §3): hive launched it for something that happened to an artifact the job
 * reported. One line or silence; never continue — the event asked nothing
 * of the job.
 */
function buildEventWakeText(args: OrchestratorJobWakeArgs, event: ArtifactEvent): string {
  return (
    `You were invoked because job \`${args.jobId}\` ("${args.title}") on workspace \`${args.workspaceSlug}\` has ${describeOutcome(args)}. ` +
    "This turn was started by neither you nor the user: hive started it for an event about an artifact the job had reported — " +
    `${describeArtifactEvent(event)} (${event.url}) — and the job's reply to that event is what you are reacting to now. ` +
    "Hive has already written the job's entry into this conversation for the user, COLLAPSED; your reply is what they read. " +
    `${renderJobReply(args)}\n` +
    "Follow the user's standing instructions in this conversation. Decide one of:\n" +
    "- **Tell the user** (the default): ONE line in your own words — what happened to the artifact and what the job did about it " +
    "(released its pod, pushed a fix, kept the pod and why). Do not restate the entry.\n" +
    `- **Stay silent:** reply with exactly \`${ORCHESTRATOR_SILENT_MARKER}\` and nothing else when there is nothing to add.\n\n` +
    'Never call job/continue from here: the event asked nothing of the job, and a reply like "merged, pod released" is not an unmet request. ' +
    "A job runs real code on the swarm; never widen the task on your own."
  );
}

/**
 * Where the conversation is read, for a turn no person asked (the wake):
 * `call` for a call's conversation — one of its rows is a `call_request`
 * (`lib/calls/callMessages.ts`) — and `tribe` for a tribe's, its
 * `TribeThread` (the tribe's name off the link; nobody asked, so no alias).
 * Neither for a web conversation. A tribe read that fails is logged and
 * the wake goes without the line: a summary in the wrong register beats
 * none.
 */
export async function conversationMedium(
  conversationId: string,
  messages: ReadonlyArray<{ source?: { kind?: string } | null }>,
): Promise<Pick<OrchestratorTurnArgs, "call" | "tribe">> {
  if (messages.some((m) => m.source?.kind === "call_request")) return { call: true };
  try {
    const thread = await db.tribeThread.findUnique({
      where: { conversationId },
      select: { link: { select: { name: true } } },
    });
    return thread ? { tribe: { name: thread.link.name } } : {};
  } catch (err) {
    logger.warn(
      "Orchestrator wake: the conversation's tribe could not be read; launching without the tribe line",
      LOG_TAG,
      {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return {};
  }
}

/**
 * Wake the orchestrator on the job row that just landed. Never throws;
 * every outcome is logged. `deps` is for tests.
 */
export async function invokeOrchestratorOnJobTurn(
  args: OrchestratorJobWakeArgs,
  deps: Partial<OrchestratorWakeDeps> = {},
): Promise<void> {
  const { launch, sleep, retryDelaysMs } = { ...defaultDeps, ...deps };
  const { conversationId, wakeId, jobId } = args;
  await runGatedAutoTurn(
    {
      tag: "orchestrator-job-wake",
      conversationId,
      wakeId,
      about: { jobId, outcome: args.outcome },
      // The launch marker of a wake carries its id: once it is there, the
      // orchestrator has (or had) the turn, whatever became of the reply.
      alreadyHandled: (messages) =>
        messages.some((m) => {
          const source = m.source as { kind?: string; wakeId?: string } | undefined;
          return source?.kind === "orchestrator_launch" && source.wakeId === wakeId;
        }),
      trailingLaunches: countTrailingJobRows,
    },
    async (conversation) => {
      const message = buildOrchestratorJobWakeText(args);
      const medium = await conversationMedium(conversationId, conversation.messages);
      for (let attempt = 0; ; attempt++) {
        const launched = await launch({
          userId: conversation.userId,
          orgId: conversation.orgId,
          conversationId,
          message,
          publicBaseUrl: args.publicBaseUrl,
          wakeId,
          ...medium,
        });
        if (launched.status === "started") {
          logger.info("Orchestrator woken on a job turn", LOG_TAG, {
            conversationId,
            wakeId,
            jobId,
            runId: launched.runId,
            attempt,
          });
          return;
        }
        if (launched.status === "error") {
          logger.warn("Orchestrator wake refused", LOG_TAG, { conversationId, wakeId, jobId, error: launched.error });
          return;
        }
        // Busy: a person's turn, or the launching turn, still has the session.
        if (attempt >= retryDelaysMs.length) {
          logger.info(
            "Orchestrator wake dropped — the session stayed busy; the orchestrator reads the job back through job/get on its next turn",
            LOG_TAG,
            {
              conversationId,
              wakeId,
              jobId,
              attempts: attempt + 1,
            },
          );
          return;
        }
        await sleep(retryDelaysMs[attempt]);
      }
    },
  );
}
