/**
 * Jamie on strut — the launch (`lib/strut-orchestrator.ts` for the
 * contract; the completion handler in `strut-runs/orchestrator-turn.ts`;
 * `docs/jamie-engine.md` for every way a turn starts).
 *
 * Every turn of an org conversation comes here — a person's message (the
 * chat route, the sync route), an automation, a check-back, a job's wake:
 * one launch of strut's `orchestrator` workflow on the org's strut
 * (`resolveStrutTarget`, purpose `orchestrator`), with the conversation's
 * row id as the `session`, the message behind the workspace line the lab's
 * agent reads, its files as the launch's `attachments`, the person's model
 * pick as `params.model`, and the time + the person's zone as
 * `context.line`. The reply lands
 * through the strut-runs webhook; the route answers at once with an empty
 * synthetic stream, and a launch-marker row (`orchestrator-launch-<id>`)
 * carries the working card until the reply row takes its place.
 *
 * A session takes one turn at a time: a second message while strut is
 * still on the first is "still working on your last message", not an
 * error — refused here before the launch when hive has a PENDING row for
 * the conversation, and read off strut's `session_busy:` when the two
 * race.
 */

import { StrutRunStatus } from "@prisma/client";
import { pageContextLine, type PageContext } from "@/lib/jamie-page-context";
import { canvasFocusContextLine, type CanvasFocus } from "@/lib/canvas/canvas-jobs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ORCHESTRATOR_BUSY_NOTE,
  ORCHESTRATOR_CALL_LINE,
  ORCHESTRATOR_TURN_KIND,
  ORCHESTRATOR_WORKFLOW,
  orchestratorContextLine,
  orchestratorLaunchRowId,
  orchestratorPrompt,
  orchestratorRowId,
  orchestratorTribeLine,
} from "@/lib/strut-orchestrator";
import type { StoredAttachment, StoredMessage } from "@/services/canvas-turn-persistence";
import { skippedAttachmentsNote, strutAttachments } from "@/services/strut-attachments";
import { cancelStrutRun, dispatchStrutRun, StrutDispatchError } from "@/services/strut-runs";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

const LOG_TAG = "STRUT_ORCHESTRATOR";

export interface OrchestratorTurnArgs {
  userId: string;
  /** `SourceControlOrg.id` — the org the conversation belongs to (its default swarm runs the turn). */
  orgId: string;
  /** The `SharedConversation` row the route has validated and written the user's message to. */
  conversationId: string;
  /** The person's message, as typed. */
  message: string;
  /**
   * The files on the message (S3 keys, as persisted): read and sent with
   * the launch, so strut's agent sees them (`strut-attachments.ts`). One it
   * cannot take is named after the message instead.
   */
  attachments?: StoredAttachment[];
  publicBaseUrl: string;
  /** The person's IANA zone for `context.line`; UTC when unknown. */
  timeZone?: string;
  now?: Date;
  /**
   * The infinite-canvas card the person asked from: told to strut as text
   * after the time, and kept on the row's input so the jobs the turn starts
   * land on that card (`lib/canvas/canvas-jobs.ts`).
   */
  focus?: CanvasFocus;
  /**
   * Where the person is — the breadcrumb path, already sanitised and
   * checked against the org (`services/jamie-page-context.ts`); told to
   * strut as the line after the canvas line.
   */
  pageContext?: PageContext;
  /**
   * The person's model pick (`User.chatAgentModel`, the composer's model
   * picker), sent as `params.model`; omitted → the workflow's own default.
   */
  model?: string;
  /**
   * The turn is a WAKE on a job row (`strut-orchestrator-wake.ts`), not a
   * person's message: recorded on the launch marker as its idempotency
   * mark. The input strut receives is the same either way.
   */
  wakeId?: string;
  /**
   * On a voice call — asked there (`/api/calls/turn`), or a wake on the
   * call's conversation (`strut-orchestrator-wake.ts`): the call line
   * (`ORCHESTRATOR_CALL_LINE`) ends `context.line`.
   */
  call?: boolean;
  /**
   * In a Sphinx tribe — asked there (`/api/tribes/messages`, the asker's
   * alias; `asker` when the turn runs as them, `userId` theirs), or a wake
   * on the tribe's conversation (no asker): the tribe line
   * (`orchestratorTribeLine`) ends `context.line`.
   */
  tribe?: { name: string | null; alias?: string; owner?: boolean; asker?: boolean };
}

export type OrchestratorLaunchResult =
  | { status: "started"; runId: string; strutRunId: string }
  | { status: "busy"; note: string }
  | { status: "error"; error: string };

/** A turn of this conversation strut has not reported yet — the busy guard before a launch. */
export async function orchestratorHasLiveTurn(conversationId: string): Promise<boolean> {
  const live = await db.strutRun.findFirst({
    where: { conversationId, kind: ORCHESTRATOR_TURN_KIND, status: StrutRunStatus.PENDING },
    select: { id: true },
  });
  return live !== null;
}

/**
 * One turn: launch the `orchestrator` workflow with the conversation as
 * its session, register it for the Stop button, write the launch marker,
 * and return at once — the reply lands through the `orchestrator_turn`
 * handler. Never throws for a refused launch.
 */
export async function launchOrchestratorTurn(args: OrchestratorTurnArgs): Promise<OrchestratorLaunchResult> {
  const { userId, orgId, conversationId, message, publicBaseUrl } = args;

  if (await orchestratorHasLiveTurn(conversationId)) return { status: "busy", note: ORCHESTRATOR_BUSY_NOTE };

  // Where the turn runs — the one policy (`strut-target.ts`), for THIS user.
  const org = await db.sourceControlOrg.findUnique({ where: { id: orgId }, select: { githubLogin: true } });
  if (!org) return { status: "error", error: "Organization not found." };
  const resolved = await resolveStrutTarget({ purpose: "orchestrator", userId, orgGithubLogin: org.githubLogin });
  if (!resolved.ok) return { status: "error", error: describeStrutTargetError(resolved.error) };
  const strut = resolved.target;

  const files = args.attachments?.length ? await strutAttachments(userId, args.attachments) : null;
  if (files?.skipped.length) {
    logger.warn("Orchestrator turn: files left out of the launch", LOG_TAG, { conversationId, skipped: files.skipped });
  }

  let dispatched: Awaited<ReturnType<typeof dispatchStrutRun>>;
  try {
    dispatched = await dispatchStrutRun({
      workspaceId: strut.workspaceId,
      userId,
      kind: ORCHESTRATOR_TURN_KIND,
      workflow: ORCHESTRATOR_WORKFLOW,
      purpose: "orchestrator",
      // The workflow's input block declares exactly these: the message
      // behind the workspace line, the conversation as the session (the
      // same every turn — strut's agent remembers through it), and what the
      // host knows about the turn — the time, and the card the person is on.
      input: {
        prompt: orchestratorPrompt(strut.workspaceSlug, message + skippedAttachmentsNote(files?.skipped ?? [])),
        session: conversationId,
        context: {
          line:
            orchestratorContextLine(args.now ?? new Date(), args.timeZone) +
            (args.focus ? canvasFocusContextLine(args.focus) : "") +
            pageContextLine(args.pageContext) +
            (args.call ? ORCHESTRATOR_CALL_LINE : "") +
            (args.tribe ? orchestratorTribeLine(args.tribe) : ""),
        },
      },
      ...(args.focus ? { rowInput: { focus: args.focus } } : {}),
      ...(args.model ? { params: { model: args.model } } : {}),
      ...(files?.attachments.length ? { attachments: files.attachments } : {}),
      publicBaseUrl,
      conversationId,
      // The jobs this turn starts report their live updates (shots,
      // recordings, holds, verdicts) to this row's events URL — strut hands
      // it on to each (CALLBACKS.md §5); `/api/strut-jobs/events` routes
      // them by the payload's `job`.
      inheritJobCallback: true,
    });
  } catch (err) {
    if (err instanceof StrutDispatchError) {
      // Strut refusing the launch because the session is still on the
      // previous message is "not yet", not a failure.
      if (/\bsession_busy:/.test(err.message) || /strut_http_409|\b409\b/.test(err.message))
        return { status: "busy", note: ORCHESTRATOR_BUSY_NOTE };
      logger.warn("Orchestrator dispatch refused", LOG_TAG, { conversationId, code: err.code });
      return {
        status: "error",
        error:
          err.code === "workflow_missing"
            ? "This swarm's strut has no `orchestrator` workflow yet (its lab is not on a build that seeds it). Update the swarm."
            : err.message,
      };
    }
    logger.error("Orchestrator dispatch failed", LOG_TAG, {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error", error: "The turn could not be started on strut." };
  }

  // The Stop button: register the run (keyed by the StrutRun id) so Stop
  // cancels it on strut. A Stop that landed before this registration
  // cancels it right away.
  try {
    const { setActiveRun, notifyRunActive } = await import("@/services/canvas-active-runs-hooks");
    const { abortSelf } = await setActiveRun(
      conversationId,
      { requestId: dispatched.runId, workspaceId: strut.workspaceId, startedAt: new Date().toISOString() },
      dispatched.runId,
    );
    if (abortSelf) {
      await cancelStrutRun({
        id: dispatched.runId,
        swarmId: dispatched.swarmId,
        workflow: ORCHESTRATOR_WORKFLOW,
        strutRunId: dispatched.strutRunId,
      });
    }
    await notifyRunActive(conversationId, true);
  } catch (err) {
    logger.warn("Orchestrator active-run registration failed (non-fatal)", LOG_TAG, {
      runId: dispatched.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // The working card's anchor, once strut has the turn: after the
  // dispatch, so a refused launch leaves no card waiting on a turn that
  // never started.
  try {
    const { appendOrchestratorRows } = await import("@/services/strut-runs/orchestrator-turn");
    await appendOrchestratorRows({ workspaceId: strut.workspaceId, userId, conversationId }, [
      {
        id: orchestratorLaunchRowId(dispatched.runId),
        content: "",
        source: {
          kind: "orchestrator_launch",
          runId: dispatched.runId,
          ...(args.wakeId ? { wakeId: args.wakeId } : {}),
        },
      },
    ]);
  } catch (err) {
    logger.warn("Orchestrator launch row not written (non-fatal)", LOG_TAG, {
      runId: dispatched.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("Orchestrator turn dispatched", LOG_TAG, {
    conversationId,
    runId: dispatched.runId,
    strutRunId: dispatched.strutRunId,
    ...(args.wakeId ? { wakeId: args.wakeId } : {}),
  });
  return { status: "started", runId: dispatched.runId, strutRunId: dispatched.strutRunId };
}

// ─── Waiting for the reply ───────────────────────────────────────────────

/** How long a caller that answers in-request waits for the reply (under the sync route's 800 s). */
export const ORCHESTRATOR_REPLY_WAIT_MS = 600_000;
const ORCHESTRATOR_REPLY_POLL_MS = 1_500;

export interface OrchestratorReplyWaitDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultWaitDeps: OrchestratorReplyWaitDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * For a caller that must answer in-request (the sync route): wait until
 * the turn's reply rows have landed in the conversation, and return them —
 * the reply (`orchestrator-<runId>`) and its proposal rows, which the
 * handler appends in one transaction. Polls the run's status (cheap) until
 * strut reported it, then the conversation. `null` when nothing landed
 * within `timeoutMs`; the rows still land later and the conversation shows
 * them.
 */
export async function awaitOrchestratorReply(
  args: { conversationId: string; runId: string; timeoutMs?: number },
  deps: Partial<OrchestratorReplyWaitDeps> = {},
): Promise<StoredMessage[] | null> {
  const { sleep, now } = { ...defaultWaitDeps, ...deps };
  const deadline = now() + (args.timeoutMs ?? ORCHESTRATOR_REPLY_WAIT_MS);
  const replyId = orchestratorRowId(args.runId);
  for (;;) {
    const run = await db.strutRun.findUnique({ where: { id: args.runId }, select: { status: true } });
    if (!run) return null;
    if (run.status !== StrutRunStatus.PENDING) {
      const conversation = await db.sharedConversation.findUnique({
        where: { id: args.conversationId },
        select: { messages: true },
      });
      const messages = Array.isArray(conversation?.messages) ? (conversation.messages as unknown as StoredMessage[]) : [];
      const rows = messages.filter((m) => m.id === replyId || m.id.startsWith(`${replyId}-`));
      if (rows.some((m) => m.id === replyId)) return rows;
    }
    if (now() >= deadline) return null;
    await sleep(ORCHESTRATOR_REPLY_POLL_MS);
  }
}

// ─── The route's answer ──────────────────────────────────────────────────

/**
 * The chat client reads a UI-message stream; a strut turn has nothing to
 * stream (the reply lands later, as rows). This is the smallest stream it
 * accepts: `text` when there is a notice to show now (busy, refused) —
 * shown locally and never persisted, since the rows are the record — and
 * no text part at all for a launch that went through.
 */
export function syntheticTurnResponse(text: string | null, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const id = `orchestrator-${Date.now().toString(36)}`;
  const parts: Array<Record<string, unknown>> = [
    { type: "start" },
    { type: "start-step" },
    ...(text
      ? [
          { type: "text-start", id },
          { type: "text-delta", id, delta: text },
          { type: "text-end", id },
        ]
      : []),
    { type: "finish-step" },
    { type: "finish" },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
      ...headers,
    },
  });
}

/**
 * The chat route's strut branch: launch the turn and answer the client.
 * The user's row is already persisted; the conversation id goes back in
 * `X-Conversation-Id` like every other turn's.
 */
export async function runOrchestratorTurn(args: OrchestratorTurnArgs): Promise<Response> {
  const launched = await launchOrchestratorTurn(args);
  const headers = { "X-Conversation-Id": args.conversationId };
  switch (launched.status) {
    case "started":
      return syntheticTurnResponse(null, headers);
    case "busy":
      return syntheticTurnResponse(launched.note, headers);
    case "error":
      return syntheticTurnResponse(`The message could not be sent to strut: ${launched.error}`, headers);
  }
}
