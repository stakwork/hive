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
 * Returns all unseen automation runs for the calling user (bounded by
 * `take`). Does NOT mark anything as seen — runs are only marked seen
 * via POST .../automations/[automationId]/seen, triggered client-side
 * when the user explicitly opens a run's conversation.
 *
 * Response: { count: number, runs: InboxRun[] }
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
      take: 20,
      select: { id: true, name: true, lastRunConversationId: true, lastRunAt: true },
    });

    return NextResponse.json({
      count: unseen.length,
      runs: unseen.map((a) => ({
        automationId: a.id,
        automationName: a.name,
        conversationId: a.lastRunConversationId,
        lastRunAt: a.lastRunAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/automations/inbox] Error:", error);
    return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
  }
}
