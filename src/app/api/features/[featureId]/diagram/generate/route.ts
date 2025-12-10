import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { generateArchitectureDiagram, GeminiError, GeminiErrorType } from "@/services/gemini-image";
import { getDiagramStorageService } from "@/services/diagram-storage";
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
          message: "Architecture text is required to generate a diagram"
        },
        { status: 400 }
      );
    }

    // Generate diagram using Gemini
    let imageBuffer: Buffer;
    try {
      imageBuffer = await generateArchitectureDiagram(feature.architecture);
    } catch (error) {
      if (error instanceof GeminiError) {
        console.error("Gemini API error:", error);

        // Return more specific error messages based on error type
        let message = "Failed to generate diagram";
        let status = 500;

        switch (error.type) {
          case GeminiErrorType.AUTHENTICATION:
            message = "AI service authentication failed. Please contact support.";
            status = 503;
            break;
          case GeminiErrorType.RATE_LIMIT:
            message = "AI service rate limit exceeded. Please try again later.";
            status = 429;
            break;
          case GeminiErrorType.INVALID_RESPONSE:
            message = "AI service returned an invalid response. Please try again.";
            status = 500;
            break;
          case GeminiErrorType.NETWORK:
            message = "Network error connecting to AI service. Please try again.";
            status = 503;
            break;
          default:
            message = error.message || "Failed to generate diagram";
            status = 500;
        }

        return NextResponse.json(
          { error: "Diagram generation failed", message },
          { status }
        );
      }

      // Unknown error
      console.error("Unknown error generating diagram:", error);
      return NextResponse.json(
        {
          error: "Diagram generation failed",
          message: "An unexpected error occurred while generating the diagram"
        },
        { status: 500 }
      );
    }

    // Upload diagram to S3
    const diagramStorageService = getDiagramStorageService();
    let uploadResult;
    try {
      uploadResult = await diagramStorageService.uploadDiagram(
        imageBuffer,
        featureId,
        feature.workspaceId
      );
    } catch (error) {
      console.error("S3 upload error:", error);
      return NextResponse.json(
        {
          error: "Storage failed",
          message: "Failed to store the diagram. Please try again."
        },
        { status: 500 }
      );
    }

    // Update feature with diagram URL and S3 key
    try {
      await db.feature.update({
        where: { id: featureId },
        data: {
          diagramUrl: uploadResult.s3Url,
          diagramS3Key: uploadResult.s3Key,
          updatedById: userOrResponse.id,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      // Try to clean up the uploaded diagram
      try {
        await diagramStorageService.deleteDiagram(uploadResult.s3Key);
      } catch (cleanupError) {
        console.error("Failed to cleanup diagram after DB error:", cleanupError);
      }

      return NextResponse.json(
        {
          error: "Database update failed",
          message: "Failed to save the diagram reference"
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        diagramUrl: uploadResult.s3Url,
        s3Key: uploadResult.s3Key,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in diagram generation endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred"
      },
      { status: 500 }
    );
  }
}
