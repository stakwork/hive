import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { updateUserStory, deleteUserStory } from "@/services/roadmap";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { storyId } = await params;
    const body = await request.json();

    const updatedStory = await updateUserStory(storyId, userId, body);

    return NextResponse.json(
      {
        success: true,
        data: updatedStory,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating user story:", error);
    const message = error instanceof Error ? error.message : "Failed to update user story";
    const status = message.includes("User story not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("Invalid") || message.includes("required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { storyId } = await params;

    await deleteUserStory(storyId, userId);

    return NextResponse.json(
      {
        success: true,
        message: "User story deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting user story:", error);
    const message = error instanceof Error ? error.message : "Failed to delete user story";
    const status = message.includes("User story not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
