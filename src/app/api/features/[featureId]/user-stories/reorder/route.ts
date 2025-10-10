import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { reorderUserStories } from "@/services/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
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

    const { featureId } = await params;
    const body = await request.json();

    const updatedStories = await reorderUserStories(featureId, userId, body.stories);

    return NextResponse.json(
      {
        success: true,
        data: updatedStories,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error reordering user stories:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder user stories";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("Invalid") || message.includes("required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
