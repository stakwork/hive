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

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { fanOutResearchToCanvas } from "@/services/canvas-research-fanout";
import { getCurrentDateSnippet } from "@/lib/constants/prompt";

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
    const { result } = await runCanvasAgent({
      userId,
      orgId,
      workspaceSlugs,
      readonly: true,
      keepWriteToolNames: ["update_research"],
      silentPusher: true,
      currentCanvasConversationId: conversationId,
      messages: [
        {
          role: "user",
          content:
            `${getCurrentDateSnippet()}\n\n` +
            `You are a research sub-agent. Your only job is to research the following topic and call update_research once with the full markdown writeup.\n\n` +
            `Research slug: ${slug}\nTopic: ${topic}\nTitle: ${title}\nSummary: ${summary}\n\n` +
            `Instructions: ${prompt}\n\n` +
            `Call web_search as many times as needed, then call update_research ONCE with the complete markdown. Do not write chat messages. Do not call any other write tools.`,
        },
      ],
    });

    // Drive the stream to completion.
    await result.text;
    await result.steps;

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
