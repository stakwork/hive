import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getPhase, updatePhase, deletePhase } from "@/services/roadmap";
import type { UpdatePhaseRequest, PhaseResponse, PhaseWithTickets } from "@/types/roadmap";
import type { ApiSuccessResponse } from "@/types/common";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser } from "@/lib/auth/public-redact";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phaseId: string }> }
) {
  try {
    const { phaseId } = await params;

    // Resolve phase → feature → workspace to decide access (members or
    // public viewers on isPublicViewable workspaces).
    const phaseMeta = await db.phase.findUnique({
      where: { id: phaseId },
      select: { feature: { select: { workspaceId: true } } },
    });
    if (!phaseMeta) {
      return NextResponse.json({ error: "Phase not found" }, { status: 404 });
    }

    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    let userIdForService: string | null = null;
    let redactForPublic = false;

    if (userOrResponse instanceof NextResponse) {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: phaseMeta.feature.workspaceId,
      });
      if (!access || access.kind !== "public-viewer") return userOrResponse;
      redactForPublic = isPublicViewer(access);
    } else {
      userIdForService = userOrResponse.id;
    }

    const phase = await getPhase(phaseId, userIdForService);

    const sanitized = redactForPublic
      ? {
          ...phase,
          tasks: phase.tasks.map((t) => ({
            ...t,
            assignee: toPublicUser((t as { assignee?: unknown }).assignee as Parameters<typeof toPublicUser>[0]),
          })),
        }
      : phase;

    return NextResponse.json<ApiSuccessResponse<PhaseWithTickets>>(
      {
        success: true,
        data: sanitized as PhaseWithTickets,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phase:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch phase";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ phaseId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { phaseId } = await params;
    const body: UpdatePhaseRequest = await request.json();

    const phase = await updatePhase(phaseId, userOrResponse.id, body);

    return NextResponse.json<PhaseResponse>(
      {
        success: true,
        data: phase,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating phase:", error);
    const message = error instanceof Error ? error.message : "Failed to update phase";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("cannot be empty") || message.includes("must be") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ phaseId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { phaseId } = await params;

    await deletePhase(phaseId, userOrResponse.id);

    return NextResponse.json(
      {
        success: true,
        message: "Phase deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting phase:", error);
    const message = error instanceof Error ? error.message : "Failed to delete phase";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
