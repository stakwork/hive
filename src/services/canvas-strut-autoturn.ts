/**
 * Canvas-agent auto-turns for the org strut: a dispatched strut CHAT that
 * settled, and a JOB turn whose reply landed.
 *
 * Both wake the canvas agent — with no HTTP user — once strut's reply is
 * already in the conversation (`canvas-strut-fanout.ts` for a chat, the
 * `job_turn` handler in `strut-runs/job-turn.ts` for a job). The agent
 * reads that reply and, following the user's standing instructions,
 * continues the work, reports to the user, or stays silent.
 *
 * Sibling of `canvas-agent-autoturn.ts` (the planner wake) and deliberately
 * thin: it reuses that module's per-message claim, the concept cache, and
 * `runCanvasAgent` end-to-end. Only a SETTLED chat post wakes the agent —
 * an interim "I'll report back" turn is shown to the user but costs no
 * turn. Every job turn wakes it: a job turn IS one reply.
 *
 * **What the job wake is for.** A job's reply is written for the record —
 * a code change lists files, functions and line numbers — and the chat
 * shows it collapsed (`JobTurnCard`). The agent's turn is the readable
 * part: a short summary in its own words, the question the job asked, the
 * next step. Its wake message says so.
 *
 * **Gating** — the same two layers as the planner wake, both default off:
 *   1. the conversation owner's `User.canvasAutonomousTurns` opt-in (the
 *      turn acts AS that user);
 *   2. the `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` master kill switch.
 *
 * **Loop breaker.** Two agents that can wake each other can cycle: strut
 * settles → this wakes the agent → it dispatches strut again → … Each round
 * is a canvas turn plus a strut turn (which has a shell and runs workflows).
 * Past `MAX_CONSECUTIVE_STRUT_DISPATCHES` launches — chat dispatches and
 * job turns alike — with no human message in between, the wake is skipped
 * and the user takes it from there.
 */

import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import { CONTINUE_JOB_TOOL, DISPATCH_STRUT_TOOL, START_JOB_TOOL } from "@/lib/ai/strutTools";
import { describeArtifactEvent, type ArtifactEvent } from "@/lib/strut-jobs";
import {
  STAY_SILENT_TOOL,
  claimAutoTurn,
  releaseAutoTurnClaim,
  hasConcepts,
  persistPromptConcepts,
} from "@/services/canvas-agent-autoturn";
import { messagesFromSteps, appendTurnMessages, type StoredMessage } from "@/services/canvas-turn-persistence";

export interface StrutAutoTurnArgs {
  /** `SharedConversation.id` the dispatch came from. */
  conversationId: string;
  /** The settled fan-out row's id — the claim + idempotency key. */
  wakeId: string;
  workspaceSlug: string;
  chatId: string;
  title: string;
  /** Strut's final turn errored. */
  failed: boolean;
  /**
   * This deployment's swarm-reachable base URL, from the webhook request's
   * `host` header — what a `dispatch_strut` made on THIS turn builds its
   * callback URL from (see `CapabilityContext.publicBaseUrl`).
   */
  publicBaseUrl: string;
}

/** How a job turn ended — `JobTurnOutcome` in `strut-runs/job-turn.ts`, repeated so this module stays light. */
export type JobWakeOutcome = "success" | "error" | "cancelled" | "lost";

export interface JobAutoTurnArgs {
  /** `SharedConversation.id` the job replies into. */
  conversationId: string;
  /** The job row's id (`job-<StrutRun.id>`) — the claim + idempotency key. */
  wakeId: string;
  workspaceSlug: string;
  jobId: string;
  title: string;
  outcome: JobWakeOutcome;
  /** The job's agent stopped for a decision: its question. */
  ask?: string;
  /** What landed on the row as cards — what the user can already see. */
  artifacts: Array<{ title: string; kind: string; label?: string }>;
  /** As `StrutAutoTurnArgs.publicBaseUrl`: a `continue_job` on the wake turn builds its callback URL from it. */
  publicBaseUrl: string;
  /**
   * The turn was started by hive for an event about an artifact the job
   * reported (strut plans/job-artifact-events.md §3) — not by the agent,
   * not by the user. The wake says so and offers one line or silence,
   * never Continue.
   */
  event?: ArtifactEvent;
}

/** See the file header. A build → test → fix loop needs 2–3. */
export const MAX_CONSECUTIVE_STRUT_DISPATCHES = 4;

/** The tool calls that launch a strut turn — each one is a round of the loop the breaker counts. */
const STRUT_LAUNCH_TOOLS: ReadonlySet<string> = new Set([DISPATCH_STRUT_TOOL, START_JOB_TOOL, CONTINUE_JOB_TOOL]);

/**
 * Strut launches (`dispatch_strut`, `start_job`, `continue_job`) in the
 * transcript tail, scanning back to the first human message (which resets
 * the window: a user who is steering is never throttled).
 */
export function countTrailingStrutDispatches(messages: StoredMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    for (const tc of m.toolCalls ?? []) {
      if (STRUT_LAUNCH_TOOLS.has(tc.toolName)) count++;
    }
  }
  return count;
}

// ─── One wake ─────────────────────────────────────────────────────────────

/** What a wake needs beyond the conversation: who is asking, and what to say. */
interface Wake {
  /** Log prefix. */
  tag: string;
  conversationId: string;
  wakeId: string;
  /** The launch's workspace: added to the turn's slug set so its tools reach it. */
  workspaceSlug: string;
  publicBaseUrl: string;
  /** What this wake is about — logged with every line. */
  about: Record<string, unknown>;
  /** The synthetic prompt; see `buildChatWakeMessage`. */
  message: ModelMessage;
  /** When the agent should call `stay_silent` — the tool's description. */
  staySilentWhen: string;
}

function buildStaySilentTool(wake: Wake): ToolSet {
  return {
    [STAY_SILENT_TOOL]: tool({
      description:
        `Call this as your terminal action when ${wake.staySilentWhen} Produces no chat message. ` +
        "Prefer this over restating strut's reply.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Optional one-line rationale. Logged only."),
      }),
      execute: async ({ reason }: { reason?: string }) => {
        console.log(`[${wake.tag}] stay_silent`, {
          conversationId: wake.conversationId,
          ...wake.about,
          reason: reason ?? null,
        });
        return { status: "silent" as const };
      },
    }),
  };
}

/**
 * The synthetic wake message for a settled chat. Role `user` and placed at
 * the TAIL of the model messages — both load-bearing; see
 * `buildWakeMessage` in `canvas-agent-autoturn.ts`. Never persisted.
 */
function buildChatWakeMessage(args: StrutAutoTurnArgs): ModelMessage {
  return {
    role: "user",
    content:
      `You were invoked because the strut chat \`${args.chatId}\` on workspace \`${args.workspaceSlug}\` ` +
      `("${args.title}") — which you dispatched — has ${args.failed ? "ended in an error" : "settled: strut is done and idle"}. ` +
      "Its replies are the most recent assistant entries above this one; read them as the thing you're reacting to now.\n\n" +
      "Follow the user's standing instructions in this conversation. Decide one of:\n" +
      `- **Continue:** call \`${DISPATCH_STRUT_TOOL}\` with \`chatId: "${args.chatId}"\` — ONLY when the user's request is ` +
      "not yet met and the next step is clearly within what they asked for (e.g. they asked for a workflow that passes its test and the run failed).\n" +
      "- **Report:** write one short paragraph telling the user the outcome, or what strut needs from them. " +
      "Don't restate strut's reply — it is already in the conversation.\n" +
      `- **Stay silent:** call \`${STAY_SILENT_TOOL}\` when strut's reply already says it all.\n\n` +
      "Default toward reporting or silence. Strut runs real code on the swarm; never widen the task on your own.",
  };
}

/** How a job turn ended, as the wake message says it. */
function describeJobOutcome(args: JobAutoTurnArgs): string {
  switch (args.outcome) {
    case "success":
      return args.ask
        ? "finished its turn and STOPPED FOR A DECISION — the entry ends with **Question for you**"
        : "finished its turn";
    case "error":
      return "failed — the entry says why";
    case "cancelled":
      return "been stopped by the user";
    case "lost":
      return "been lost: strut restarted before recording it, so its prompt would have to be sent again";
  }
}

/**
 * The synthetic wake message for a job turn. Same role and placement rules
 * as `buildChatWakeMessage`. The point of the turn is a summary: the job's
 * reply is the detailed record and the chat shows it collapsed.
 */
function buildJobWakeMessage(args: JobAutoTurnArgs): ModelMessage {
  const cards =
    args.artifacts.length > 0
      ? "What it produced is attached to that entry as cards the user can open: " +
        args.artifacts.map((a) => `${a.title} (${a.label ?? a.kind})`).join(", ") +
        "."
      : "Nothing is attached to it.";
  if (args.event) return { role: "user", content: buildJobEventWakeText(args, args.event, cards) };
  return {
    role: "user",
    content:
      `You were invoked because job \`${args.jobId}\` ("${args.title}") on workspace \`${args.workspaceSlug}\` ` +
      `— which you started — has ${describeJobOutcome(args)}. ` +
      "Its reply is the most recent assistant entry above this one, headed **Job · …**; read it as the thing you're reacting to now. " +
      `${cards}\n\n` +
      "That entry is the record, and the chat shows it COLLAPSED: it is written in detail (a code change lists files, functions and line numbers) " +
      "and the user expands it only to check. Your reply is what they read. " +
      "Follow the user's standing instructions in this conversation. Decide one of:\n" +
      "- **Summarize** (the default): write one short paragraph in your own words — what the job produced, the question it asked if it asked one, " +
      "and the next step. Do not restate the entry, do not list files, functions or line numbers, and do not describe the cards — the user sees them.\n" +
      `- **Continue:** call \`${CONTINUE_JOB_TOOL}\` with \`jobId: "${args.jobId}"\` — ONLY when the user's request is not yet met and the next step ` +
      "is clearly within what they asked for (the job's question is one their instructions already answer, or they asked for a result this turn did not reach).\n" +
      `- **Stay silent:** call \`${STAY_SILENT_TOOL}\` when there is nothing to add — the user stopped the turn themselves, or the entry is one line that says it all.\n\n` +
      "Default toward a summary. A job runs real code on the swarm; never widen the task on your own.",
  };
}

/**
 * The wake for a turn an EVENT started (strut plans/job-artifact-events.md
 * §3): hive launched it for something that happened to an artifact the job
 * reported — a pull request merging, failing its checks. The job's reply
 * is the thing to react to; the user is told in one line, or not at all.
 * Never Continue: the event asked nothing of the job, and "merged, pod
 * released" is not an unmet request. (An event turn is not a tool call,
 * so the loop breaker never counts it; this is what keeps the wake from
 * launching the next turn itself.)
 */
function buildJobEventWakeText(args: JobAutoTurnArgs, event: ArtifactEvent, cards: string): string {
  return (
    `You were invoked because job \`${args.jobId}\` ("${args.title}") on workspace \`${args.workspaceSlug}\` has ${describeJobOutcome(args)}. ` +
    "This turn was started by neither you nor the user: hive started it for an event about an artifact the job had reported — " +
    `${describeArtifactEvent(event)} (${event.url}) — and the job's reply to that event is the most recent assistant entry above this one, ` +
    "headed **Job · …**; read it as the thing you're reacting to now. " +
    `${cards}\n\n` +
    "That entry is the record, and the chat shows it COLLAPSED; your reply is what the user reads. " +
    "Follow the user's standing instructions in this conversation. Decide one of:\n" +
    "- **Tell the user** (the default): ONE line in your own words — what happened to the artifact and what the job did about it " +
    "(released its pod, pushed a fix, kept the pod and why). Do not restate the entry.\n" +
    `- **Stay silent:** call \`${STAY_SILENT_TOOL}\` when there is nothing to add.\n\n` +
    `Never call \`${CONTINUE_JOB_TOOL}\` from here: the event asked nothing of the job, and a reply like "merged, pod released" is not an unmet request. ` +
    "A job runs real code on the swarm; never widen the task on your own."
  );
}

// ─── Entry points ─────────────────────────────────────────────────────────

export async function invokeCanvasAgentOnStrutSettled(args: StrutAutoTurnArgs): Promise<void> {
  await invokeWake({
    tag: "canvas-strut-autoturn",
    conversationId: args.conversationId,
    wakeId: args.wakeId,
    workspaceSlug: args.workspaceSlug,
    publicBaseUrl: args.publicBaseUrl,
    about: { chatId: args.chatId },
    message: buildChatWakeMessage(args),
    staySilentWhen:
      "strut's reply needs NO visible response from you — it already says everything the user needs and nothing is left to drive.",
  });
}

export async function invokeCanvasAgentOnJobTurn(args: JobAutoTurnArgs): Promise<void> {
  await invokeWake({
    tag: "canvas-job-autoturn",
    conversationId: args.conversationId,
    wakeId: args.wakeId,
    workspaceSlug: args.workspaceSlug,
    publicBaseUrl: args.publicBaseUrl,
    about: { jobId: args.jobId, outcome: args.outcome },
    message: buildJobWakeMessage(args),
    staySilentWhen:
      "the job's reply needs NO visible response from you — the user stopped it themselves, or its entry is one line that already says the one thing they need.",
  });
}

// ─── The turn ─────────────────────────────────────────────────────────────

async function invokeWake(wake: Wake): Promise<void> {
  const { tag, conversationId, wakeId, about } = wake;

  if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED === "false") {
    console.log(`[${tag}] skipped (master kill switch)`, { conversationId, wakeId });
    return;
  }

  let claimed = false;
  try {
    claimed = await claimAutoTurn(conversationId, wakeId);
    if (!claimed) {
      console.log(`[${tag}] already claimed/handled; skipping`, { conversationId, wakeId });
      return;
    }
    await runWake(wake);
  } catch (e) {
    console.error(`[${tag}] failed (non-fatal):`, {
      conversationId,
      wakeId,
      ...about,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (claimed) {
      await releaseAutoTurnClaim(conversationId, wakeId).catch((e) =>
        console.error(`[${tag}] claim release failed:`, e),
      );
    }
  }
}

async function runWake(wake: Wake): Promise<void> {
  const { tag, conversationId, wakeId, workspaceSlug, about } = wake;

  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: {
      userId: true,
      sourceControlOrgId: true,
      messages: true,
      settings: true,
      workspace: { select: { slug: true } },
      user: { select: { canvasAutonomousTurns: true } },
    },
  });
  if (!conversation?.userId || !conversation.sourceControlOrgId) {
    console.log(`[${tag}] conversation gone or not owner+org scoped; skipping`, { conversationId });
    return;
  }
  if (!conversation.user?.canvasAutonomousTurns) {
    console.log(`[${tag}] skipped (autonomous turns off)`, { conversationId });
    return;
  }

  const storedMessages = Array.isArray(conversation.messages)
    ? (conversation.messages as unknown as StoredMessage[])
    : [];

  const idPrefix = `autoturn-${wakeId}-`;
  if (storedMessages.some((m) => m.id?.startsWith?.(idPrefix))) return;

  const trailing = countTrailingStrutDispatches(storedMessages);
  if (trailing >= MAX_CONSECUTIVE_STRUT_DISPATCHES) {
    console.error(
      `[${tag}] LOOP BREAKER tripped — too many consecutive strut launches with no human message between; skipping this wake.`,
      { conversationId, wakeId, ...about, trailing },
    );
    return;
  }

  // The slug set the user-driven canvas chat used, plus the launch's
  // workspace. Deduped, capped at 20 — as in the planner wake.
  const settings = (conversation.settings ?? {}) as { extraWorkspaceSlugs?: unknown; promptConcepts?: unknown };
  const slugSet = new Set<string>();
  if (conversation.workspace?.slug) slugSet.add(conversation.workspace.slug);
  if (Array.isArray(settings.extraWorkspaceSlugs)) {
    for (const s of settings.extraWorkspaceSlugs) if (typeof s === "string") slugSet.add(s);
  }
  slugSet.add(workspaceSlug);
  const workspaceSlugs = Array.from(slugSet).slice(0, 20);

  const cachedConcepts =
    settings.promptConcepts && typeof settings.promptConcepts === "object"
      ? (settings.promptConcepts as CachedConcepts)
      : null;

  const { result, cacheableConcepts, cacheHit } = await runCanvasAgent({
    userId: conversation.userId,
    orgId: conversation.sourceControlOrgId,
    workspaceSlugs,
    messages: [...toModelMessages(storedMessages), wake.message],
    cachedConcepts,
    silentPusher: true,
    currentCanvasConversationId: conversationId,
    publicBaseUrl: wake.publicBaseUrl,
    additionalTools: buildStaySilentTool(wake),
  });

  if (!cacheHit && hasConcepts(cacheableConcepts)) {
    void persistPromptConcepts(conversationId, cacheableConcepts).catch((e) =>
      console.error(`[${tag}] prompt-cache persist failed:`, e),
    );
  }

  await result.text;
  const steps = await result.steps;
  const rows = messagesFromSteps(
    steps as Parameters<typeof messagesFromSteps>[0],
    idPrefix,
    new Set([STAY_SILENT_TOOL]),
  );
  await appendTurnMessages({ conversationId, rows, idPrefix, reason: "autoturn" });

  console.log(`[${tag}] completed`, { conversationId, wakeId, ...about, appendedRows: rows.length });
}
