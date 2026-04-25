import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { Prisma } from "@prisma/client";

const MILESTONE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  features: {
    select: {
      id: true,
      title: true,
      workspace: { select: { id: true, name: true } },
    },
    take: 1,
  },
} as const;

type MilestoneWithRelations = {
  features: { id: string; title: string; workspace: { id: string; name: string } }[];
  [key: string]: unknown;
};

function serializeMilestone({ features, ...rest }: MilestoneWithRelations) {
  return { ...rest, feature: features[0] ?? null };
}

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
    const { name, description, status, sequence, dueDate, assigneeId, completedAt, featureId } = body;

    // If a featureId is being connected, verify it belongs to a workspace in this org
    // before any write to prevent cross-org feature linking (IDOR).
    if (featureId) {
      const orgWorkspaces = await db.workspace.findMany({
        where: { deleted: false, sourceControlOrgId: orgId },
        select: { id: true },
      });
      const orgWorkspaceIds = orgWorkspaces.map((w) => w.id);
      const targetFeature = await db.feature.findFirst({
        where: { id: featureId, deleted: false, workspaceId: { in: orgWorkspaceIds } },
        select: { id: true },
      });
      if (!targetFeature) {
        return NextResponse.json({ error: "Feature not found" }, { status: 404 });
      }
    }

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
        ...(featureId !== undefined && {
          features: featureId
            ? { connect: { id: featureId } }
            : { set: [] },
        }),
      },
      include: MILESTONE_INCLUDE,
    });

    return NextResponse.json(serializeMilestone(milestone as MilestoneWithRelations));
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
