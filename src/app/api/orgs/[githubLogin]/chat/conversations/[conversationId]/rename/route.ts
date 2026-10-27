import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";

const MAX_TITLE_LENGTH = 200;

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

/**
 * POST /api/orgs/[githubLogin]/chat/conversations/[conversationId]/rename
 *
 * Owner-only rename of an org-canvas conversation. The stored title is
 * only ever auto-generated while empty / placeholder, so a user-set title
 * is never overwritten by later message saves. Missing / foreign /
 * non-org-canvas rows return 404 (IDOR-safe).
 *
 * Body: `{ title: string }` — trimmed, non-empty, max 200 chars.
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
    return NextResponse.json({ error: "title string is required" }, { status: 400 });
  }

  const rawTitle =
    body !== null && typeof body === "object" ? (body as { title?: unknown }).title : undefined;
  if (typeof rawTitle !== "string") {
    return NextResponse.json({ error: "title string is required" }, { status: 400 });
  }
  const title = rawTitle.trim();
  if (!title) {
    return NextResponse.json({ error: "title must not be empty" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `title must be at most ${MAX_TITLE_LENGTH} characters` },
      { status: 400 },
    );
  }

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
      data: { title },
    });

    if (count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/orgs/[githubLogin]/chat/conversations/[id]/rename] Error:",
      error,
    );
    return NextResponse.json({ error: "Failed to rename conversation" }, { status: 500 });
  }
}
