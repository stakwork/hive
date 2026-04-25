import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { Prisma } from "@prisma/client";

const MILESTONE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string; milestoneId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId, milestoneId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify milestone belongs to the specified initiative (and initiative belongs to org)
    const existing = await db.milestone.findFirst({
      where: {
        id: milestoneId,
        initiativeId,
        initiative: { orgId },
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, status, sequence, dueDate, assigneeId, completedAt } = body;

    const milestone = await db.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(sequence !== undefined && { sequence: Number(sequence) }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
      },
      include: MILESTONE_INCLUDE,
    });

    return NextResponse.json(milestone);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A milestone with this sequence already exists for this initiative" },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]] Error:", error);
    return NextResponse.json({ error: "Failed to update milestone" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string; milestoneId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId, milestoneId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify milestone belongs to the specified initiative (and initiative belongs to org)
    const existing = await db.milestone.findFirst({
      where: {
        id: milestoneId,
        initiativeId,
        initiative: { orgId },
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    // SetNull on Feature.milestoneId is handled by DB cascade
    await db.milestone.delete({ where: { id: milestoneId } });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]] Error:", error);
    return NextResponse.json({ error: "Failed to delete milestone" }, { status: 500 });
  }
}
