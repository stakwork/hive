/**
 * POST /api/orgs/[githubLogin]/planner-forms/answer
 *
 * Phase 4 of `docs/plans/canvas-agent-manages-planners.md`. Lets the
 * user answer a feature planner's clarifying-questions FORM **from the
 * canvas chat** (via `PlannerFormSlot`) instead of navigating to the
 * per-feature plan page. One user action, two server-side writes:
 *
 *   1. Forward the formatted answer to the planner — exactly what the
 *      plan page does: `sendFeatureChatMessage` with `replyId` set to
 *      the planner message that asked, so the service pairs the answer
 *      back to the FORM and kicks the planning workflow forward.
 *   2. Append a `source: { kind: "user-answered-planner-form", … }`
 *      row to the owning canvas conversation (the same
 *      transaction-protected append the planner fan-out uses) so the
 *      canvas agent (on its next turn) and the audit trail / voice /
 *      iOS surfaces all see what was answered.
 *
 * Idempotent on `(conversationId, plannerMessageId)`: a double-submit
 * (or a retry) neither re-forwards to the planner nor double-appends.
 *
 * Auth: session required (protected middleware default — no policy
 * entry needed, see `src/config/middleware.ts`). `resolveAuthorizedOrgId`
 * confirms the caller belongs to the org; `sendFeatureChatMessage`
 * additionally enforces workspace owner/membership before any write.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";

export const runtime = "nodejs";

interface AnswerBody {
  featureId?: unknown;
  plannerMessageId?: unknown;
  answer?: unknown;
}

/** Stored canvas message row shape (the `Json` column is untyped). */
interface CanvasMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  source: {
    kind: "user-answered-planner-form";
    featureId: string;
    plannerMessageId: string;
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const body = (await request.json()) as AnswerBody;
    const featureId =
      typeof body.featureId === "string" ? body.featureId : "";
    const plannerMessageId =
      typeof body.plannerMessageId === "string" ? body.plannerMessageId : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";

    if (!featureId || !plannerMessageId || !answer) {
      return NextResponse.json(
        {
          error:
            "featureId, plannerMessageId, and a non-empty answer are required",
        },
        { status: 400 },
      );
    }

    // Org gate (defense-in-depth; the real write-auth is on the
    // feature's workspace, enforced inside sendFeatureChatMessage).
    // `false` = read access is enough to qualify here.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        parentCanvasConversationId: true,
        workspace: { select: { sourceControlOrgId: true } },
      },
    });
    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }
    if (feature.workspace.sourceControlOrgId !== orgId) {
      return NextResponse.json(
        { error: "Feature does not belong to this organization" },
        { status: 403 },
      );
    }

    const conversationId = feature.parentCanvasConversationId;

    // Idempotency: if this FORM was already answered (double-submit /
    // retry), do nothing — don't re-forward to the planner.
    if (conversationId) {
      const already = await answerAlreadyRecorded(
        conversationId,
        plannerMessageId,
      );
      if (already) {
        return NextResponse.json({ status: "already_answered" });
      }
    }

    // 1. Forward to the planner (same path the plan page uses). This
    //    enforces workspace owner/membership and starts the next
    //    planning run.
    await sendFeatureChatMessage({
      featureId,
      userId,
      message: answer,
      replyId: plannerMessageId,
    });

    // 2. Append the canvas-conversation record (best-effort; the
    //    planner already has the answer, so a fan-out hiccup must not
    //    fail the request). Skipped when the feature has no owning
    //    canvas conversation (answered from a non-canvas surface).
    if (conversationId) {
      try {
        await appendAnswerRow(conversationId, featureId, plannerMessageId, answer);
      } catch (e) {
        console.error(
          "[planner-forms/answer] canvas append failed (non-fatal):",
          e,
        );
      }
    }

    return NextResponse.json({ status: "answered" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit answer";
    // Surface the planner's own guard messages (e.g. "A planning
    // workflow is already running") as a 409 so the UI can show them.
    const isConflict = /already running/i.test(message);
    console.error("[planner-forms/answer] error:", message);
    return NextResponse.json(
      { error: message },
      { status: isConflict ? 409 : 500 },
    );
  }
}

/**
 * Has this FORM already been answered in the canvas conversation?
 * Scans the `messages` JSON for a `user-answered-planner-form` row
 * matching `plannerMessageId`.
 */
async function answerAlreadyRecorded(
  conversationId: string,
  plannerMessageId: string,
): Promise<boolean> {
  const row = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { messages: true },
  });
  if (!row || !Array.isArray(row.messages)) return false;
  return (row.messages as unknown as CanvasMessageRow[]).some(
    (m) =>
      m.source?.kind === "user-answered-planner-form" &&
      m.source.plannerMessageId === plannerMessageId,
  );
}

/**
 * Append a `user-answered-planner-form` row under the same row-level
 * lock the planner fan-out and the autosave PUT use, so all writers
 * serialize on the conversation row. Idempotent on `plannerMessageId`.
 */
async function appendAnswerRow(
  conversationId: string,
  featureId: string,
  plannerMessageId: string,
  answer: string,
): Promise<void> {
  // A compact, human-readable summary for the thread entry / voice
  // surfaces. Full answer already lives in the planner's chat history.
  const summary = answer.length > 140 ? `${answer.slice(0, 137)}…` : answer;

  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as CanvasMessageRow[])
      : [];

    const alreadyAppended = existing.some(
      (m) =>
        m.source?.kind === "user-answered-planner-form" &&
        m.source.plannerMessageId === plannerMessageId,
    );
    if (alreadyAppended) return;

    const newRow: CanvasMessageRow = {
      id: `answered-${plannerMessageId}`,
      role: "user",
      content: `Answered: ${summary}`,
      timestamp: new Date().toISOString(),
      source: {
        kind: "user-answered-planner-form",
        featureId,
        plannerMessageId,
      },
    };

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...existing, newRow] as unknown as never,
        lastMessageAt: new Date(),
      },
    });
  });
}
