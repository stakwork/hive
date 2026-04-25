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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId } = await params;
  const userId = userOrResponse.id;

  try {
    const body = await request.json();
    const { name, description, status, sequence, dueDate, assigneeId, completedAt } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (sequence === undefined || sequence === null) {
      return NextResponse.json({ error: "sequence is required" }, { status: 400 });
    }
    const seq = Number(sequence);
    if (!Number.isInteger(seq)) {
      return NextResponse.json({ error: "sequence must be an integer" }, { status: 400 });
    }

    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify initiative belongs to this org
    const initiative = await db.initiative.findFirst({
      where: { id: initiativeId, orgId },
      select: { id: true },
    });
    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    const milestone = await db.milestone.create({
      data: {
        initiativeId,
        name: name.trim(),
        sequence: seq,
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
      },
      include: MILESTONE_INCLUDE,
    });

    return NextResponse.json(serializeMilestone(milestone as MilestoneWithRelations), { status: 201 });
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
    console.error("[POST /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones] Error:", error);
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 });
  }
}
