import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { notifyCanvasUpdatedByLogin } from "@/lib/canvas";

const MILESTONE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
} as const;

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
    const { milestones } = body;

    if (!Array.isArray(milestones) || milestones.length === 0) {
      return NextResponse.json({ error: "milestones array is required" }, { status: 400 });
    }

    // Validate each entry has id and sequence
    for (const m of milestones) {
      if (!m.id || typeof m.id !== "string") {
        return NextResponse.json({ error: "Each milestone must have a valid id" }, { status: 400 });
      }
      if (m.sequence === undefined || !Number.isInteger(Number(m.sequence))) {
        return NextResponse.json({ error: "Each milestone must have a valid integer sequence" }, { status: 400 });
      }
    }

    // Reject duplicate sequences within the payload
    const sequences = milestones.map((m: { id: string; sequence: number }) => Number(m.sequence));
    if (new Set(sequences).size !== sequences.length) {
      return NextResponse.json(
        { error: "Duplicate sequence values in payload" },
        { status: 409 },
      );
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

    // Verify all milestone IDs belong to the specified initiative
    const incomingIds = milestones.map((m: { id: string; sequence: number }) => m.id);
    const existingMilestones = await db.milestone.findMany({
      where: { id: { in: incomingIds }, initiativeId },
      select: { id: true },
    });
    if (existingMilestones.length !== incomingIds.length) {
      return NextResponse.json(
        { error: "One or more milestone IDs do not belong to this initiative" },
        { status: 400 },
      );
    }

    // Atomically update all sequences
    await db.$transaction(
      milestones.map((m: { id: string; sequence: number }) =>
        db.milestone.update({
          where: { id: m.id },
          data: { sequence: Number(m.sequence) },
        }),
      ),
    );

    const updatedMilestones = await db.milestone.findMany({
      where: { initiativeId },
      include: MILESTONE_INCLUDE,
      orderBy: { sequence: "asc" },
    });

    // Reorder only changes the timeline's x-axis layout (sequence drives
    // default placement). The root rollup is unaffected (count of
    // COMPLETED milestones doesn't depend on order), so we don't fan
    // out to the root canvas — keeps the refetch surface minimal.
    void notifyCanvasUpdatedByLogin(
      githubLogin,
      `initiative:${initiativeId}`,
      "milestones-reordered",
      { initiativeId, count: milestones.length },
    );

    return NextResponse.json(updatedMilestones);
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/reorder] Error:", error);
    return NextResponse.json({ error: "Failed to reorder milestones" }, { status: 500 });
  }
}
