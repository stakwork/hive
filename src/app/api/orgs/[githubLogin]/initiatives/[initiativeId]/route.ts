import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

const INITIATIVE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  milestones: {
    orderBy: { sequence: "asc" as const },
    include: {
      assignee: { select: { id: true, name: true } },
    },
  },
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify initiative belongs to this org
    const existing = await db.initiative.findFirst({
      where: { id: initiativeId, orgId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, status, assigneeId, startDate, targetDate, completedAt } = body;

    const initiative = await db.initiative.update({
      where: { id: initiativeId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
      },
      include: INITIATIVE_INCLUDE,
    });

    return NextResponse.json(initiative);
  } catch (error) {
    console.error("[PATCH /api/orgs/[githubLogin]/initiatives/[initiativeId]] Error:", error);
    return NextResponse.json({ error: "Failed to update initiative" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify initiative belongs to this org
    const existing = await db.initiative.findFirst({
      where: { id: initiativeId, orgId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    // DB cascade removes Milestones; SetNull handles Feature.milestoneId
    await db.initiative.delete({ where: { id: initiativeId } });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/initiatives/[initiativeId]] Error:", error);
    return NextResponse.json({ error: "Failed to delete initiative" }, { status: 500 });
  }
}
