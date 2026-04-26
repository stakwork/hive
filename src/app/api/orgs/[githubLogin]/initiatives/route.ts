import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { notifyCanvasUpdatedByLogin } from "@/lib/canvas";
import {
  MILESTONE_INCLUDE,
  serializeMilestone,
  type MilestoneWithFeatures,
} from "@/lib/initiatives/milestone-serialize";

// Reuse the milestone include shape so nested-on-initiative reads
// surface the same `features` array (and legacy `feature` shim) as
// the dedicated milestone routes. Keeps the wire shape consistent
// regardless of which endpoint a client uses to discover a milestone.
const INITIATIVE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  milestones: {
    orderBy: { sequence: "asc" as const },
    include: MILESTONE_INCLUDE,
  },
} as const;

type InitiativeWithMilestones = {
  milestones: MilestoneWithFeatures[];
  [key: string]: unknown;
};

function serializeInitiative(initiative: InitiativeWithMilestones) {
  return {
    ...initiative,
    milestones: initiative.milestones.map(serializeMilestone),
  };
}

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

    const initiatives = await db.initiative.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      include: INITIATIVE_INCLUDE,
    });

    return NextResponse.json(
      initiatives.map((i) => serializeInitiative(i as InitiativeWithMilestones)),
    );
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/initiatives] Error:", error);
    return NextResponse.json({ error: "Failed to fetch initiatives" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const body = await request.json();
    const { name, description, status, assigneeId, startDate, targetDate, completedAt } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const initiative = await db.initiative.create({
      data: {
        orgId,
        name: name.trim(),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
      },
      include: INITIATIVE_INCLUDE,
    });

    // Tell open canvases the root projection changed. Fire-and-forget;
    // a Pusher hiccup mustn't fail the user-visible POST.
    void notifyCanvasUpdatedByLogin(githubLogin, "", "initiative-created", {
      initiativeId: initiative.id,
    });

    return NextResponse.json(
      serializeInitiative(initiative as InitiativeWithMilestones),
      { status: 201 },
    );
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/initiatives] Error:", error);
    return NextResponse.json({ error: "Failed to create initiative" }, { status: 500 });
  }
}
