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
 * GET /api/orgs/[githubLogin]/automations/inbox
 *
 * Returns the conversation id of the most recent UNSEEN automation run for
 * the calling user (so the canvas can auto-open it), and marks all currently
 * unseen runs as seen. Reading the inbox IS the "seen" signal — the canvas
 * fetches this once on load.
 *
 * Response: { conversationId: string | null, automationId?, automationName? }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const unseen = await db.automation.findMany({
      where: {
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
        lastRunSeenAt: null,
        lastRunConversationId: { not: null },
      },
      orderBy: { lastRunAt: "desc" },
      select: { id: true, name: true, lastRunConversationId: true },
    });

    if (unseen.length === 0) {
      return NextResponse.json({ conversationId: null });
    }

    // Mark every unseen run as seen; only the most recent one is auto-opened.
    const now = new Date();
    await db.automation.updateMany({
      where: { id: { in: unseen.map((a) => a.id) } },
      data: { lastRunSeenAt: now },
    });

    const latest = unseen[0];
    return NextResponse.json({
      conversationId: latest.lastRunConversationId,
      automationId: latest.id,
      automationName: latest.name,
    });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/automations/inbox] Error:", error);
    return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
  }
}
