import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export async function GET(
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

    // Fetch all user stories for this feature
    const userStories = await db.userStory.findMany({
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
      },
      orderBy: {
        order: "asc",
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: userStories,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching user stories:", error);
    return NextResponse.json(
      { error: "Failed to fetch user stories" },
      { status: 500 }
    );
  }
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
    const { title } = body;

    // Validate required fields
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "Missing required field: title" },
        { status: 400 }
      );
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

    // Verify that the user exists in the database
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get the maximum order value for this feature to auto-increment
    const maxOrderStory = await db.userStory.findFirst({
      where: {
        featureId,
      },
      orderBy: {
        order: "desc",
      },
      select: {
        order: true,
      },
    });

    const nextOrder = (maxOrderStory?.order ?? -1) + 1;

    // Create the user story
    const userStory = await db.userStory.create({
      data: {
        title: title.trim(),
        featureId,
        order: nextOrder,
        completed: false,
        createdById: userId,
        updatedById: userId,
      },
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
        data: userStory,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating user story:", error);
    return NextResponse.json(
      { error: "Failed to create user story" },
      { status: 500 }
    );
  }
}
