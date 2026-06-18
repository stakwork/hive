import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

/**
 * POST /api/orgs/[githubLogin]/chat/conversations/[conversationId]/seen
 *
 * Stamp `ownerSeenAt = now()` so the history list stops flagging this
 * conversation as unread. Owner-only: scoped by `userId`, so a non-owner
 * (shared-room viewer) silently no-ops rather than clobbering the owner's
 * read state — and a missing/foreign row returns 404 for IDOR safety.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; conversationId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, conversationId } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // updateMany so a non-owner / wrong-org id matches zero rows instead of
    // throwing — we report 404 when nothing was stamped.
    const { count } = await db.sharedConversation.updateMany({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
      },
      data: { ownerSeenAt: new Date() },
    });

    if (count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/orgs/[githubLogin]/chat/conversations/[id]/seen] Error:",
      error,
    );
    return NextResponse.json({ error: "Failed to mark seen" }, { status: 500 });
  }
}
