import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { LayoutAlgorithm } from "@/services/excalidraw-layout";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { createDiagramStakworkRun } from "@/services/stakwork-run";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    const body = await request.json().catch(() => ({}));
    const layout = (body.layout as LayoutAlgorithm) || "layered";

    // Fetch the feature with workspace ID
    const feature = await db.feature.findUnique({
      where: {
        id: featureId,
      },
      select: {
        id: true,
        title: true,
        architecture: true,
        workspaceId: true,
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found", message: "Feature not found" },
        { status: 404 }
      );
    }

    // Validate workspace access
    const accessValidation = await validateWorkspaceAccessById(
      feature.workspaceId,
      userOrResponse.id
    );

    if (!accessValidation.hasAccess || !accessValidation.canWrite) {
      return NextResponse.json(
        { error: "Access denied", message: "Access denied" },
        { status: 403 }
      );
    }

    // Validate architecture text exists
    if (!feature.architecture || feature.architecture.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Architecture text required",
          message:
            "Architecture text is required to generate a whiteboard diagram",
        },
        { status: 400 }
      );
    }

    // Find or create the whiteboard linked to this feature
    let whiteboard = await db.whiteboard.findUnique({
      where: { featureId: feature.id },
      select: { id: true },
    });

    if (!whiteboard) {
      whiteboard = await db.whiteboard.create({
        data: {
          name: `${feature.title} - Whiteboard`,
          workspaceId: feature.workspaceId,
          featureId: feature.id,
        },
        select: { id: true },
      });
    }

    // Fire-and-forget: create a Stakwork run for async diagram generation
    const run = await createDiagramStakworkRun({
      workspaceId: feature.workspaceId,
      featureId: feature.id,
      whiteboardId: whiteboard.id,
      architectureText: feature.architecture,
      layout,
      userId: userOrResponse.id,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          runId: run.id,
          status: run.status,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error in whiteboard generation endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
