/**
 * Canvas graph-walk sub-agent worker.
 *
 * Runs a focused `runCanvasAgent` loop with `readonly: true` +
 * `keepWriteToolNames: ["finalize_graph_walk"]` so the sub-agent can:
 *   - Call the four `graph_walker` read-only tools as many times as needed.
 *   - Call `finalize_graph_walk` once with the synthesized text answer.
 *   - NOT call `dispatch_graph_walk` (stripped — prevents self-redispatch).
 *   - NOT call any other write tools (canvas mutations, proposals, etc.).
 *
 * After the loop completes, it:
 *   - Persists the sub-agent's full tool-call trace to a standalone
 *     `SharedConversation` row (`source: "graph-walk"`, id
 *     `gw-conv-${graphWalkId}`) via `messagesFromSteps`. That `source`
 *     keeps the row out of every history list; it exists so the trace
 *     is reviewable and deep-linkable.
 *   - Fans the answer back into the owning canvas conversation via
 *     `fanOutGraphWalkToCanvas`, stashing the trace row's id on the
 *     result bubble's `source.detailConversationId` as a backlink.
 *
 * Mirrors `canvas-research-worker.ts`:
 *   - Best-effort advisory lock prevents duplicate concurrent runs.
 *   - Idempotency check skips the run when a fan-out row already exists.
 *   - Auth guard validates the conversation belongs to the expected org/user.
 *   - Time budget hook (soft + hard) prevents Vercel function overruns.
 *   - Non-fatal: any failure is logged and swallowed; a "failed" fan-out
 *     row is appended so the user always sees a visible result card.
 *
 * Called by `src/app/api/ask/quick/route.ts` in its `after()` block,
 * one call per `dispatch_graph_walk` tool invocation in the stream.
 */

import {
  hasToolCall,
  type ModelMessage,
  type PrepareStepFunction,
  type ToolSet,
} from "ai";
import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { fanOutGraphWalkToCanvas } from "@/services/canvas-graph-walk-fanout";
import { messagesFromSteps } from "@/services/canvas-turn-persistence";
import type { DispatchedGraphWalkIntent } from "@/lib/ai/graphWalkDispatchTools";

/**
 * Time budget for a graph-walk sub-agent run.
 *
 *   SOFT_BUDGET_MS — communicated to the agent via per-step notes so it
 *     paces itself and doesn't over-gather.
 *   HARD_BUDGET_MS — the enforced cutover. Once elapsed, `prepareStep`
 *     restricts `activeTools` to `finalize_graph_walk` and forces the
 *     model to call it, so a synthesized answer always lands even if
 *     the walk was not complete. Set below soft AND well under the
 *     Vercel `maxDuration` (800s) to leave headroom for one in-flight
 *     KG call to return.
 */
const SOFT_BUDGET_MS = 300_000; // 5 min — communicated to the agent
const HARD_BUDGET_MS = 240_000; // 4 min — forced finalize cutover

const FINALIZE_TOOL = "finalize_graph_walk";

/**
 * Tool names stripped from the persisted trace. `finalize_graph_walk`
 * carries the synthesized answer as its input — that text is already the
 * fan-out bubble's content, so showing it again as a tool row is noise.
 * The trace we keep is the graph traversal itself (graph_search, etc.).
 */
const TRACE_STRIP_TOOLS: ReadonlySet<string> = new Set([FINALIZE_TOOL]);

/**
 * Persist the sub-agent's full tool-call trace to a standalone
 * `SharedConversation` row. The row uses `source: "graph-walk"` so it is
 * invisible to every history-list query (they allow-list `"org-canvas"`
 * / `"dashboard"` / `"logs-agent"`); it exists purely so the trace is
 * reviewable and deep-linkable from the parent's result bubble.
 *
 * The row id is deterministic (`gw-conv-${graphWalkId}`) and the write is
 * an upsert, so a worker retry overwrites rather than duplicates.
 *
 * Non-fatal: on any failure we log and return `undefined`; the caller
 * still fans the answer bubble out, just without a backlink.
 */
async function persistGraphWalkTrace(args: {
  graphWalkId: string;
  title: string;
  orgId: string;
  userId: string;
  steps: Parameters<typeof messagesFromSteps>[0];
}): Promise<string | undefined> {
  const { graphWalkId, title, orgId, userId, steps } = args;
  const id = `gw-conv-${graphWalkId}`;
  try {
    const rows = messagesFromSteps(steps, "gw-", TRACE_STRIP_TOOLS);
    await db.sharedConversation.upsert({
      where: { id },
      create: {
        id,
        sourceControlOrgId: orgId,
        userId,
        source: "graph-walk",
        title,
        messages: rows as unknown as never,
        followUpQuestions: [] as unknown as never,
        lastMessageAt: new Date(),
      },
      update: {
        messages: rows as unknown as never,
        lastMessageAt: new Date(),
      },
    });
    return id;
  } catch (e) {
    console.error("[canvas-graph-walk] persist trace failed (non-fatal)", {
      graphWalkId,
      title,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

/**
 * Build the per-step budget hook for a single graph-walk run.
 * Closes over the run's start time. Before every step it strips any
 * stale budget note, appends a fresh elapsed-time note, and — once
 * past the hard budget — narrows the toolset to `finalize_graph_walk`
 * and forces the call.
 */
function buildBudgetPrepareStep(
  startMs: number,
  logCtx: { graphWalkId: string; title: string },
): PrepareStepFunction<ToolSet> {
  let forcedLogged = false;
  return ({ messages, stepNumber }) => {
    const elapsedMs = Date.now() - startMs;
    const elapsedS = Math.round(elapsedMs / 1000);
    const overHard = elapsedMs >= HARD_BUDGET_MS;

    // Per-step heartbeat for operator visibility.
    console.log("[canvas-graph-walk] step budget", {
      ...logCtx,
      stepNumber,
      elapsedS,
      hardBudgetS: Math.round(HARD_BUDGET_MS / 1000),
      overHard,
    });
    if (overHard && !forcedLogged) {
      forcedLogged = true;
      console.log(
        "[canvas-graph-walk] HARD BUDGET reached — restricting to finalize_graph_walk and forcing finalize",
        { ...logCtx, elapsedS },
      );
    }

    // Drop any prior injected note so they don't accumulate across steps.
    const base = (messages as ModelMessage[]).filter(
      (m) =>
        !(
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.startsWith("[TIME BUDGET]")
        ),
    );

    const note = overHard
      ? `[TIME BUDGET] ${elapsedS}s elapsed — your hard deadline has passed. Stop all graph traversal. Call ${FINALIZE_TOOL} NOW with a complete synthesized answer using whatever you have gathered so far.`
      : `[TIME BUDGET] ${elapsedS}s elapsed of a ~${Math.round(
          SOFT_BUDGET_MS / 1000,
        )}s budget. Finish all graph traversal before ${Math.round(
          HARD_BUDGET_MS / 1000,
        )}s, then call ${FINALIZE_TOOL} once. Be efficient — avoid redundant or overly deep traversals.`;

    const withNote: ModelMessage[] = [
      ...base,
      { role: "user", content: note },
    ];

    if (overHard) {
      return {
        messages: withNote,
        activeTools: [FINALIZE_TOOL],
        toolChoice: { type: "tool", toolName: FINALIZE_TOOL },
      };
    }
    return { messages: withNote };
  };
}

export interface GraphWalkSubAgentArgs extends DispatchedGraphWalkIntent {
  workspaceSlugs: string[];
}

/**
 * Run a focused graph-walk sub-agent for one dispatched intent.
 * Returns void; all outcomes (ready / failed) are reported via
 * `fanOutGraphWalkToCanvas` and logged under `[canvas-graph-walk]`.
 */
export async function runGraphWalkSubAgent(
  args: GraphWalkSubAgentArgs,
): Promise<void> {
  const {
    graphWalkId,
    title,
    prompt,
    conversationId,
    orgId,
    userId,
    workspaceSlugs,
  } = args;

  const lockKey = `canvas-graph-walk:${conversationId}:${graphWalkId}`;

  let lockAcquired = false;
  try {
    // Best-effort advisory lock — non-blocking; skip if already running.
    const lockResult = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `;
    lockAcquired = lockResult?.[0]?.locked === true;
    if (!lockAcquired) {
      console.log(
        "[canvas-graph-walk] advisory lock not acquired — skipping duplicate run",
        { conversationId, graphWalkId, title },
      );
      return;
    }

    // Auth guard BEFORE any resource work: the conversation must belong
    // to the expected org and user. A mismatched conversationId cannot
    // be used to write into a foreign conversation.
    const conversation = await db.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, sourceControlOrgId: true },
    });
    if (!conversation) {
      console.log("[canvas-graph-walk] conversation not found — aborting", {
        conversationId,
        graphWalkId,
        title,
      });
      return;
    }
    if (
      conversation.sourceControlOrgId !== orgId ||
      conversation.userId !== userId
    ) {
      console.log(
        "[canvas-graph-walk] auth guard failed — conversation org/user mismatch",
        {
          conversationId,
          graphWalkId,
          title,
          expectedOrgId: orgId,
          actualOrgId: conversation.sourceControlOrgId,
        },
      );
      return;
    }

    // Idempotency: skip if a graph_walk fan-out row for this graphWalkId
    // already exists in the conversation messages.
    const existing = await db.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { messages: true },
    });
    if (existing) {
      const msgs = Array.isArray(existing.messages)
        ? (existing.messages as Array<{ source?: { kind?: string; graphWalkId?: string } }>)
        : [];
      const alreadyFannedOut = msgs.some(
        (m) =>
          m.source?.kind === "graph_walk" &&
          m.source?.graphWalkId === graphWalkId,
      );
      if (alreadyFannedOut) {
        console.log(
          "[canvas-graph-walk] fan-out row already exists — skipping (idempotent)",
          { conversationId, graphWalkId, title },
        );
        return;
      }
    }

    console.log("[canvas-graph-walk] starting sub-agent run", {
      conversationId,
      graphWalkId,
      title,
    });

    // Sink for the sub-agent's synthesized answer.
    const graphWalkAnswerSink: { answer: string | null } = { answer: null };

    const { result } = await runCanvasAgent({
      userId,
      orgId,
      workspaceSlugs,
      readonly: true,
      capabilities: ["graph_walker"],
      keepWriteToolNames: [FINALIZE_TOOL],
      silentPusher: true,
      currentCanvasConversationId: conversationId,
      graphWalkAnswerSink,
      prepareStep: buildBudgetPrepareStep(Date.now(), { graphWalkId, title }),
      // End the loop as soon as the answer is written.
      extraStopConditions: [hasToolCall(FINALIZE_TOOL)],
      messages: [
        {
          role: "user",
          content:
            `You are a knowledge-graph traversal sub-agent. Your only job is to answer the following ` +
            `query by walking the knowledge graph and then call ${FINALIZE_TOOL} ONCE with the complete ` +
            `synthesized text answer.\n\n` +
            `Task title: ${title}\n\n` +
            `Instructions:\n${prompt}\n\n` +
            `Use the graph_walker tools (graph_ontology, graph_search, graph_get, graph_neighbors) ` +
            `to gather the information needed. Then call ${FINALIZE_TOOL} with a clear, well-structured ` +
            `answer covering everything found. Be efficient — avoid redundant traversals. ` +
            `You are on a strict time budget (see the [TIME BUDGET] notes). ` +
            `Do not write chat messages. Do not call any other write tools.`,
        },
      ],
    });

    // Drive the stream to completion.
    await result.text;
    const steps = await result.steps;

    const answer = graphWalkAnswerSink.answer;
    const status: "ready" | "failed" =
      answer !== null && answer.length > 0 ? "ready" : "failed";

    console.log("[canvas-graph-walk] completed", {
      conversationId,
      graphWalkId,
      title,
      status,
    });

    // Persist the full tool-call trace to a hidden standalone
    // conversation, then link it from the fan-out bubble.
    const detailConversationId = await persistGraphWalkTrace({
      graphWalkId,
      title,
      orgId,
      userId,
      steps: steps as Parameters<typeof messagesFromSteps>[0],
    });

    await fanOutGraphWalkToCanvas(conversationId, {
      graphWalkId,
      title,
      answer: answer ?? "",
      status,
      detailConversationId,
    });
  } catch (e) {
    console.error("[canvas-graph-walk] failed (non-fatal)", {
      conversationId,
      graphWalkId,
      title,
      error: e instanceof Error ? e.message : String(e),
    });

    // Best-effort: fan out a failure row so the user sees the card.
    try {
      await fanOutGraphWalkToCanvas(conversationId, {
        graphWalkId,
        title,
        answer: "",
        status: "failed",
      });
    } catch (fanoutErr) {
      console.error(
        "[canvas-graph-walk] fan-out on error also failed",
        {
          conversationId,
          graphWalkId,
          error:
            fanoutErr instanceof Error
              ? fanoutErr.message
              : String(fanoutErr),
        },
      );
    }
  } finally {
    // Release advisory lock if we acquired it.
    if (lockAcquired) {
      await db.$queryRaw`
        SELECT pg_advisory_unlock(hashtext(${lockKey}))
      `.catch((e) => {
        console.error(
          "[canvas-graph-walk] advisory unlock failed (non-fatal)",
          {
            lockKey,
            error: e instanceof Error ? e.message : String(e),
          },
        );
      });
    }
  }
}
