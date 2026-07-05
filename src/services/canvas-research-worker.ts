/**
 * Canvas research sub-agent worker.
 *
 * Runs a focused `runCanvasAgent` loop with `readonly: true` +
 * `keepWriteToolNames: ["update_research"]` so the sub-agent can:
 *   - Call `web_search` as many times as needed.
 *   - Call `update_research` once with the synthesized markdown.
 *   - NOT call any other write tools (canvas mutations, proposals, etc.).
 *
 * After the loop completes, fans the result back into the owning canvas
 * conversation via `fanOutResearchToCanvas`.
 *
 * Designed as a sibling to `canvas-agent-autoturn.ts`:
 *   - Best-effort advisory lock prevents duplicate runs.
 *   - Idempotency check skips the run when content is already written.
 *   - Auth guard validates the conversation belongs to the expected org/user.
 *   - Non-fatal: any failure is logged and swallowed; the Research row
 *     exists on the canvas regardless.
 *
 * Called by `src/app/api/ask/quick/route.ts` in its `after()` block,
 * one call per `dispatch_research` tool invocation in the stream.
 */

import {
  hasToolCall,
  type ModelMessage,
  type PrepareStepFunction,
  type ToolSet,
} from "ai";
import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { fanOutResearchToCanvas } from "@/services/canvas-research-fanout";
import { messagesFromSteps } from "@/services/canvas-turn-persistence";
import { getCurrentDateSnippet } from "@/lib/constants/prompt";

/**
 * Time budget for a research sub-agent run. The worker executes inside
 * the dispatching request's Vercel `after()` block, so the whole run
 * shares that function's `maxDuration` (800s). We carve that into:
 *
 *   - SOFT_BUDGET_MS — what the agent is *told* it has. An elapsed-time
 *     note is injected before every step so it paces itself and avoids
 *     over-gathering (e.g. fanning the slow `repo_agent` across repos).
 *   - HARD_BUDGET_MS — the enforced cutover. Once elapsed, `prepareStep`
 *     restricts `activeTools` to `update_research` and forces the model
 *     to call it, so a timely (possibly partial) writeup always lands
 *     instead of the run dying empty at the 800s wall. Set below the
 *     soft budget AND well under 800s to leave headroom for one
 *     in-flight tool call (a `repo_agent` call can run minutes and
 *     cannot be interrupted mid-flight) plus the finalize step.
 */
const SOFT_BUDGET_MS = 600_000; // 10 min — communicated to the agent
const HARD_BUDGET_MS = 480_000; // 8 min — forced finalize cutover

const FINALIZE_TOOL = "update_research";

/**
 * Build the per-step budget hook for a single run. Closes over the run's
 * start time. Before every step it strips any stale budget note, appends
 * a fresh elapsed-time note, and — once past the hard budget — narrows
 * the toolset to `update_research` and forces the call.
 */
function buildBudgetPrepareStep(
  startMs: number,
  logCtx: { slug: string; researchId: string },
): PrepareStepFunction<ToolSet> {
  let forcedLogged = false;
  return ({ messages, stepNumber }) => {
    const elapsedMs = Date.now() - startMs;
    const elapsedS = Math.round(elapsedMs / 1000);
    const overHard = elapsedMs >= HARD_BUDGET_MS;

    // Per-step heartbeat — steps are minutes apart, so this is low-volume
    // and lets operators watch a run pace against its budget in the logs.
    console.log("[canvas-research] step budget", {
      ...logCtx,
      stepNumber,
      elapsedS,
      hardBudgetS: Math.round(HARD_BUDGET_MS / 1000),
      overHard,
    });
    if (overHard && !forcedLogged) {
      forcedLogged = true;
      console.log(
        "[canvas-research] HARD BUDGET reached — restricting to update_research and forcing finalize",
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
      ? `[TIME BUDGET] ${elapsedS}s elapsed — your hard deadline has passed. Stop all searching. Call ${FINALIZE_TOOL} NOW with the complete markdown writeup using whatever you have gathered so far.`
      : `[TIME BUDGET] ${elapsedS}s elapsed of a ~${Math.round(
          SOFT_BUDGET_MS / 1000,
        )}s budget. Finish all gathering (web_search / repo_agent) before ${Math.round(
          HARD_BUDGET_MS / 1000,
        )}s, then call ${FINALIZE_TOOL} once. Be efficient — avoid redundant or overly deep tool calls.`;

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

export interface ResearchSubAgentArgs {
  researchId: string;
  slug: string;
  topic: string;
  title: string;
  summary: string;
  prompt: string;
  conversationId: string;
  orgId: string;
  userId: string;
  workspaceSlugs: string[];
  initiativeId?: string;
}

/**
 * Run a focused research sub-agent for one dispatched research task.
 * Returns void; all outcomes (ready / failed) are reported via
 * `fanOutResearchToCanvas` and logged under `[canvas-research]`.
 */
export async function runResearchSubAgent(
  args: ResearchSubAgentArgs,
): Promise<void> {
  const {
    researchId,
    slug,
    topic,
    title,
    summary,
    prompt,
    conversationId,
    orgId,
    userId,
    workspaceSlugs,
    initiativeId,
  } = args;

  const lockKey = `canvas-research:${conversationId}:${researchId}`;

  // Best-effort advisory lock — same pattern as invokeCanvasAgentOnPlannerMessage.
  // Uses pg_try_advisory_lock (non-blocking); if another instance is already
  // running this job we skip rather than queue.
  let lockAcquired = false;
  try {
    const lockResult = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `;
    lockAcquired = lockResult?.[0]?.locked === true;
    if (!lockAcquired) {
      console.log("[canvas-research] advisory lock not acquired — skipping duplicate run", {
        conversationId,
        researchId,
        slug,
      });
      return;
    }

    // Auth guard: the conversation must belong to the expected org and user.
    // Performed BEFORE any resource lookup so a mismatched conversationId
    // cannot be used to probe foreign research rows.
    const conversation = await db.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, sourceControlOrgId: true },
    });
    if (!conversation) {
      console.log("[canvas-research] conversation not found — aborting", {
        conversationId,
        researchId,
        slug,
      });
      return;
    }
    if (
      conversation.sourceControlOrgId !== orgId ||
      conversation.userId !== userId
    ) {
      console.log("[canvas-research] auth guard failed — conversation org/user mismatch", {
        conversationId,
        researchId,
        slug,
        expectedOrgId: orgId,
        actualOrgId: conversation.sourceControlOrgId,
      });
      return;
    }

    // Idempotency: skip if content is already written (a previous run succeeded).
    // Scoped to orgId so a foreign researchId cannot probe across org boundaries.
    const existing = await db.research.findFirst({
      where: { id: researchId, orgId },
      select: { content: true },
    });
    if (!existing) {
      console.log("[canvas-research] research row not found — skipping", {
        conversationId,
        researchId,
        slug,
      });
      return;
    }
    if (existing.content !== null) {
      console.log("[canvas-research] content already written — skipping (idempotent)", {
        conversationId,
        researchId,
        slug,
      });
      return;
    }

    console.log("[canvas-research] starting sub-agent run", {
      conversationId,
      researchId,
      slug,
      topic,
    });

    // Run the research sub-agent with readonly: true but keep update_research.
    // The budget hook + stop condition keep it from running past the
    // dispatching function's wall: it paces against a soft budget, is
    // forced to finalize once past the hard budget, and the loop ends the
    // instant the doc is written (see buildBudgetPrepareStep).
    const { result } = await runCanvasAgent({
      userId,
      orgId,
      workspaceSlugs,
      readonly: true,
      keepWriteToolNames: [FINALIZE_TOOL],
      silentPusher: true,
      currentCanvasConversationId: conversationId,
      prepareStep: buildBudgetPrepareStep(Date.now(), { slug, researchId }),
      // End the loop as soon as the doc is written — the worker's sole
      // job is one `update_research` call. Fires only AFTER the write, so
      // it never truncates gathering or yields an empty result.
      extraStopConditions: [hasToolCall(FINALIZE_TOOL)],
      messages: [
        {
          role: "user",
          content:
            `${getCurrentDateSnippet()}\n\n` +
            `You are a research sub-agent. Your only job is to research the following topic and call ${FINALIZE_TOOL} once with the full markdown writeup.\n\n` +
            `Research slug: ${slug}\nTopic: ${topic}\nTitle: ${title}\nSummary: ${summary}\n\n` +
            `Instructions: ${prompt}\n\n` +
            `Gather efficiently, then call ${FINALIZE_TOOL} ONCE with the complete markdown. Keep the writeup focused and well-structured — cover the requested sections without padding. ` +
            `Prefer broad, high-signal queries over many narrow sequential ones; a handful of strong sources beats exhaustive coverage. ` +
            `Use web_search for anything external/third-party. repo_agent is for the user's OWN codebases ONLY and is SLOW (each call takes minutes) — use it sparingly, if at all. ` +
            `You are on a strict time budget (see the [TIME BUDGET] notes); do not over-gather. Do not write chat messages. Do not call any other write tools.`,
        },
      ],
    });

    // Drive the stream to completion.
    await result.text;
    const steps = await result.steps;

    // Convert steps to StoredMessage rows, stripping the finalize tool call
    // (its content is already surfaced in the card row appended by fanout).
    const subAgentMessages = messagesFromSteps(
      steps as Parameters<typeof messagesFromSteps>[0],
      `research-${researchId}-`,
      new Set([FINALIZE_TOOL]),
    );

    // Determine final status by re-reading the row — scoped to orgId.
    const updated = await db.research.findFirst({
      where: { id: researchId, orgId },
      select: { content: true },
    });
    const status: "ready" | "failed" =
      updated?.content !== null && updated?.content !== undefined
        ? "ready"
        : "failed";

    console.log("[canvas-research] completed", {
      conversationId,
      researchId,
      slug,
      status,
    });

    // Fan the result back into the canvas conversation.
    await fanOutResearchToCanvas(conversationId, {
      researchId,
      slug,
      topic,
      title,
      summary,
      status,
      initiativeId,
      subAgentMessages,
    });
  } catch (e) {
    console.error("[canvas-research] failed (non-fatal)", {
      conversationId,
      researchId,
      slug,
      error: e instanceof Error ? e.message : String(e),
    });

    // Best-effort: try to fan out a failure row so the user sees the card.
    try {
      await fanOutResearchToCanvas(conversationId, {
        researchId,
        slug,
        topic,
        title,
        summary,
        status: "failed",
        initiativeId,
      });
    } catch (fanoutErr) {
      console.error("[canvas-research] fan-out on error also failed", {
        conversationId,
        researchId,
        error:
          fanoutErr instanceof Error ? fanoutErr.message : String(fanoutErr),
      });
    }
  } finally {
    // Release advisory lock if we acquired it.
    if (lockAcquired) {
      await db.$queryRaw`
        SELECT pg_advisory_unlock(hashtext(${lockKey}))
      `.catch((e) => {
        console.error("[canvas-research] advisory unlock failed (non-fatal)", {
          lockKey,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
  }
}
