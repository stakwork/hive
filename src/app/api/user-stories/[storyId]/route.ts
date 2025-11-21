import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { updateUserStory, deleteUserStory } from "@/services/roadmap";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storyId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { storyId } = await params;
    const body = await request.json();

    const updatedStory = await updateUserStory(storyId, userOrResponse.id, body);

    return NextResponse.json(
      {
        success: true,
        data: updatedStory,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating user story:", error);
    const message = error instanceof Error ? error.message : "Failed to update user story";
    const status = message.includes("User story not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("Invalid") || message.includes("required")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ storyId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { storyId } = await params;

    await deleteUserStory(storyId, userOrResponse.id);

    return NextResponse.json(
      {
        success: true,
        message: "User story deleted successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting user story:", error);
    const message = error instanceof Error ? error.message : "Failed to delete user story";
    const status = message.includes("User story not found") ? 404 : message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
