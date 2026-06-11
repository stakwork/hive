import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { CanvasReviewStatus } from "@prisma/client";

const VALID_STATUSES: CanvasReviewStatus[] = [
  CanvasReviewStatus.DISMISSED,
  CanvasReviewStatus.ACKNOWLEDGED,
  CanvasReviewStatus.ACTIONED,
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; cardId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, cardId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const card = await db.canvasReviewCard.findUnique({ where: { id: cardId } });
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    // IDOR guard — must belong to this org AND this user
    if (card.orgId !== orgId || card.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const { status } = body;

    if (!status || !VALID_STATUSES.includes(status as CanvasReviewStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = { status };
    if (status === CanvasReviewStatus.DISMISSED) {
      updateData.dismissedAt = new Date();
    } else if (status === CanvasReviewStatus.ACTIONED) {
      updateData.actionedAt = new Date();
    }

    const updated = await db.canvasReviewCard.update({
      where: { id: cardId },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /canvas/janitor/cards/[cardId]] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
