import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

interface ReorderItem {
  id: string;
  order: number;
}

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
    const { stories }: { stories: ReorderItem[] } = body;

    // Validate input
    if (!Array.isArray(stories) || stories.length === 0) {
      return NextResponse.json(
        { error: "Invalid request: stories array is required" },
        { status: 400 }
      );
    }

    // Validate each story item
    for (const story of stories) {
      if (!story.id || typeof story.order !== "number" || story.order < 0) {
        return NextResponse.json(
          { error: "Invalid story data: id and order are required" },
          { status: 400 }
        );
      }
    }

    // Verify feature exists and get its workspace
    const feature = await db.feature.findUnique({
      where: {
        id: featureId,
      },
      select: {
        id: true,
        workspaceId: true,
        workspace: {
          select: {
            id: true,
            ownerId: true,
            deleted: true,
            members: {
              where: {
                userId: userId,
              },
              select: {
                role: true,
              },
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

    if (feature.workspace.deleted) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is workspace owner or member
    const isOwner = feature.workspace.ownerId === userId;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Verify all story IDs belong to this feature
    const storyIds = stories.map((s) => s.id);
    const existingStories = await db.userStory.findMany({
      where: {
        id: {
          in: storyIds,
        },
        featureId: featureId,
      },
      select: {
        id: true,
      },
    });

    if (existingStories.length !== storyIds.length) {
      return NextResponse.json(
        { error: "One or more story IDs are invalid for this feature" },
        { status: 400 }
      );
    }

    // Update all story orders in a transaction
    await db.$transaction(
      stories.map((story) =>
        db.userStory.update({
          where: {
            id: story.id,
          },
          data: {
            order: story.order,
            updatedById: userId,
          },
        })
      )
    );

    // Fetch updated stories
    const updatedStories = await db.userStory.findMany({
      where: {
        featureId,
      },
      select: {
        id: true,
        title: true,
        order: true,
        completed: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        order: "asc",
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedStories,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error reordering user stories:", error);
    return NextResponse.json(
      { error: "Failed to reorder user stories" },
      { status: 500 }
    );
  }
}
