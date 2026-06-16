import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { updateDeferredCheckStatus } from "@/services/deferred-check";

/**
 * DELETE /api/orgs/[githubLogin]/chat/deferred-actions/[deferredActionId]
 *
 * Cancel a pending deferred chat action. Returns 404 (not 403) for IDOR
 * safety when the action doesn't exist or belongs to another user.
 */
export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ githubLogin: string; deferredActionId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, deferredActionId } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    // Resolve org id for the scoping check
    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Fetch the action — scope to org and ownership for IDOR safety.
    // Return 404 (not 403) regardless of why it's missing so callers
    // can't distinguish "doesn't exist" from "not yours".
    const action = await db.deferredChatAction.findFirst({
      where: {
        id: deferredActionId,
        orgId: org.id,
      },
      select: {
        id: true,
        userId: true,
        status: true,
        conversationId: true,
      },
    });

    if (!action || action.userId !== userOrResponse.id) {
      return NextResponse.json({ error: "Deferred action not found" }, { status: 404 });
    }

    if (action.status !== "PENDING") {
      return NextResponse.json(
        { error: "Action is not cancellable" },
        { status: 400 },
      );
    }

    // Flip the DeferredChatAction row -> CANCELLED and patch the matching
    // deferredCheck.status in the conversation messages JSON. Both writes
    // happen atomically inside `updateDeferredCheckStatus` (single
    // transaction). Ownership/scope was already validated above via the
    // org-scoped `findFirst` + userId check, so updating by id is safe.
    await updateDeferredCheckStatus(
      action.conversationId,
      deferredActionId,
      "CANCELLED",
    );

    // Live-sync: notify other open tabs so their card updates immediately.
    notifyCanvasConversationUpdated(
      action.conversationId,
      "deferred-check-cancelled",
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[DELETE /api/orgs/[githubLogin]/chat/deferred-actions/[id]] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to cancel deferred action" },
      { status: 500 },
    );
  }
}
