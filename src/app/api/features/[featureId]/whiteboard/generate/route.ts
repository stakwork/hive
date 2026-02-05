import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  generateExcalidrawFromArchitecture,
  ExcalidrawData,
} from "@/services/excalidraw-generator";
import { validateWorkspaceAccessById } from "@/services/workspace";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

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

    // Generate Excalidraw elements using OpenAI
    let excalidrawData: ExcalidrawData;
    try {
      excalidrawData = await generateExcalidrawFromArchitecture(
        feature.architecture
      );
    } catch (error) {
      console.error("Error generating whiteboard:", error);
      const message = error instanceof Error ? error.message : "Failed to generate whiteboard diagram";
      return NextResponse.json(
        { error: "Whiteboard generation failed", message },
        { status: 500 }
      );
    }

    // Check if whiteboard already exists for this feature
    let whiteboard = await db.whiteboard.findUnique({
      where: { featureId },
    });

    if (whiteboard) {
      // Update existing whiteboard with generated elements
      whiteboard = await db.whiteboard.update({
        where: { id: whiteboard.id },
        data: {
          elements: excalidrawData.elements as unknown as Prisma.InputJsonValue,
          appState: excalidrawData.appState as Prisma.InputJsonValue,
        },
      });
    } else {
      // Create new whiteboard linked to feature
      whiteboard = await db.whiteboard.create({
        data: {
          name: `${feature.title} - Architecture`,
          workspaceId: feature.workspaceId,
          featureId: feature.id,
          elements: excalidrawData.elements as unknown as Prisma.InputJsonValue,
          appState: excalidrawData.appState as Prisma.InputJsonValue,
          files: {},
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: whiteboard.id,
          name: whiteboard.name,
          elements: whiteboard.elements,
          appState: whiteboard.appState,
        },
      },
      { status: 200 }
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
