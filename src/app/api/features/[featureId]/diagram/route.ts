import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import {
  generateArchitectureDiagram,
  GeminiError,
  GeminiErrorType,
} from "@/services/gemini-image";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        architecture: true,
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!feature.architecture) {
      return NextResponse.json(
        {
          error: "No architecture description available for this feature",
        },
        { status: 400 }
      );
    }

    // Generate diagram
    const imageBuffer = await generateArchitectureDiagram(
      feature.architecture
    );

    // Store diagram URL (as data URI)
    await db.feature.update({
      where: { id: featureId },
      data: {
        diagramUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
        diagramGeneratedAt: new Date(),
      },
    });

    // Return image
    return new NextResponse(new Uint8Array(imageBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Diagram generation error:", error);

    if (error instanceof GeminiError) {
      const statusMap: Record<GeminiErrorType, number> = {
        [GeminiErrorType.AUTHENTICATION]: 401,
        [GeminiErrorType.RATE_LIMIT]: 429,
        [GeminiErrorType.INVALID_RESPONSE]: 502,
        [GeminiErrorType.NETWORK]: 503,
        [GeminiErrorType.UNKNOWN]: 500,
      };

      return NextResponse.json(
        { error: error.message, type: error.type },
        { status: statusMap[error.type] }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate diagram" },
      { status: 500 }
    );
  }
}
