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
 * POST /api/orgs/[githubLogin]/chat/conversations/[conversationId]/archive
 *
 * Owner-only archive / restore of an org-canvas conversation. Sets
 * `archivedAt` server-side (`new Date()` or `null`); never copies a
 * client timestamp. A joiner in a shared room cannot archive the
 * owner's chat — `isShared` is not consulted. Missing / foreign /
 * non-org-canvas rows return 404 (IDOR-safe, never 403).
 *
 * Body: `{ archived: boolean }` only.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "archived boolean is required" }, { status: 400 });
  }

  if (
    body === null ||
    typeof body !== "object" ||
    !("archived" in body) ||
    typeof (body as { archived: unknown }).archived !== "boolean"
  ) {
    return NextResponse.json({ error: "archived boolean is required" }, { status: 400 });
  }

  const archived = (body as { archived: boolean }).archived;

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // updateMany so a non-owner / wrong-org / non-org-canvas id matches
    // zero rows instead of throwing — we report 404 when nothing moved.
    const { count } = await db.sharedConversation.updateMany({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
        source: "org-canvas",
      },
      data: { archivedAt: archived ? new Date() : null },
    });

    if (count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/orgs/[githubLogin]/chat/conversations/[id]/archive] Error:",
      error,
    );
    return NextResponse.json({ error: "Failed to archive conversation" }, { status: 500 });
  }
}
