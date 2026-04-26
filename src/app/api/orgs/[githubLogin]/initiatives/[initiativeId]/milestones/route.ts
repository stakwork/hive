import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { notifyCanvasesUpdatedByLogin } from "@/lib/canvas";
import {
  MILESTONE_INCLUDE,
  serializeMilestone,
  type MilestoneWithFeatures,
} from "@/lib/initiatives/milestone-serialize";
import { Prisma } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const initiative = await db.initiative.findFirst({
      where: { id: initiativeId, orgId },
      select: { id: true },
    });
    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    const count = await db.milestone.count({ where: { initiativeId } });
    return NextResponse.json({ count });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones] Error:", error);
    return NextResponse.json({ error: "Failed to fetch milestone count" }, { status: 500 });
  }
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

    // The new milestone appears on the timeline sub-canvas; the
    // root-level initiative card's milestone-completion footer also
    // changes (denominator went up), so refresh both.
    void notifyCanvasesUpdatedByLogin(
      githubLogin,
      ["", `initiative:${initiativeId}`],
      "milestone-created",
      { initiativeId, milestoneId: milestone.id },
    );

    return NextResponse.json(serializeMilestone(milestone as MilestoneWithFeatures), { status: 201 });
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
