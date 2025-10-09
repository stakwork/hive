import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

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
    const { title, order, completed } = body;

    // Verify user story exists and get its feature and workspace
    const existingStory = await db.userStory.findUnique({
      where: {
        id: storyId,
      },
      select: {
        id: true,
        featureId: true,
        feature: {
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
        },
      },
    });

    if (!existingStory) {
      return NextResponse.json(
        { error: "User story not found" },
        { status: 404 }
      );
    }

    if (existingStory.feature.workspace.deleted) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is workspace owner or member
    const isOwner = existingStory.feature.workspace.ownerId === userId;
    const isMember = existingStory.feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Build update data object with only provided fields
    const updateData: {
      title?: string;
      order?: number;
      completed?: boolean;
      updatedById: string;
    } = {
      updatedById: userId,
    };

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json(
          { error: "Invalid title: must be a non-empty string" },
          { status: 400 }
        );
      }
      updateData.title = title.trim();
    }

    if (order !== undefined) {
      if (typeof order !== "number" || order < 0) {
        return NextResponse.json(
          { error: "Invalid order: must be a non-negative number" },
          { status: 400 }
        );
      }
      updateData.order = order;
    }

    if (completed !== undefined) {
      if (typeof completed !== "boolean") {
        return NextResponse.json(
          { error: "Invalid completed: must be a boolean" },
          { status: 400 }
        );
      }
      updateData.completed = completed;
    }

    // Update the user story
    const updatedStory = await db.userStory.update({
      where: {
        id: storyId,
      },
      data: updateData,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        feature: {
          select: {
            id: true,
            title: true,
            workspaceId: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedStory,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating user story:", error);
    return NextResponse.json(
      { error: "Failed to update user story" },
      { status: 500 }
    );
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

    // Verify user story exists and get its feature and workspace
    const existingStory = await db.userStory.findUnique({
      where: {
        id: storyId,
      },
      select: {
        id: true,
        featureId: true,
        feature: {
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
        },
      },
    });

    if (!existingStory) {
      return NextResponse.json(
        { error: "User story not found" },
        { status: 404 }
      );
    }

    if (existingStory.feature.workspace.deleted) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is workspace owner or member
    const isOwner = existingStory.feature.workspace.ownerId === userId;
    const isMember = existingStory.feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Delete the user story
    await db.userStory.delete({
      where: {
        id: storyId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "User story deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting user story:", error);
    return NextResponse.json(
      { error: "Failed to delete user story" },
      { status: 500 }
    );
  }
}
