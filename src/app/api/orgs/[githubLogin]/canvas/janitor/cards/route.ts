import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const [cards, config] = await Promise.all([
      db.canvasReviewCard.findMany({
        where: { orgId, userId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      }),
      db.canvasJanitorConfig.findUnique({
        where: { orgId },
        select: { lastRunAt: true },
      }),
    ]);

    return NextResponse.json({
      cards,
      pendingCount: cards.length,
      lastRunAt: config?.lastRunAt ?? null,
    });
  } catch (error) {
    console.error("[GET /canvas/janitor/cards] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
