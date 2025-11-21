import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { reorderUserStories } from "@/services/roadmap";

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body = await request.json();

    const updatedStories = await reorderUserStories(featureId, userOrResponse.id, body.stories);

    return NextResponse.json(
      {
        success: true,
        data: updatedStories,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error reordering user stories:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder user stories";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("Invalid") || message.includes("required")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
