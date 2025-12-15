import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { detectFeatureRequest } from "@/lib/ai/wake-word-detector";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { chunk, workspaceSlug } = body;

    if (!chunk || !workspaceSlug) {
      return NextResponse.json(
        { error: "Missing required fields: chunk, workspaceSlug" },
        { status: 400 }
      );
    }

    if (typeof chunk !== "string" || chunk.trim().length === 0) {
      return NextResponse.json(
        { error: "Chunk must be a non-empty string" },
        { status: 400 }
      );
    }

    // Detect if this is a feature request
    const isFeatureRequest = await detectFeatureRequest(chunk, workspaceSlug);

    return NextResponse.json(
      {
        success: true,
        isFeatureRequest,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ Error detecting feature request:", error);
    const message =
      error instanceof Error ? error.message : "Failed to detect feature request";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
