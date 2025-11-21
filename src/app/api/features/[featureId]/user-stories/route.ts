import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { createUserStory } from "@/services/roadmap";
import type { CreateUserStoryRequest, UserStoryListResponse, UserStoryResponse } from "@/types/roadmap";

export async function GET(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

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
                userId: userOrResponse.id,
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
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    if (feature.workspace.deleted) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = feature.workspace.ownerId === userOrResponse.id;
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

    return NextResponse.json<UserStoryListResponse>(
      {
        success: true,
        data: userStories,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching user stories:", error);
    return NextResponse.json({ error: "Failed to fetch user stories" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body: CreateUserStoryRequest = await request.json();

    const userStory = await createUserStory(featureId, userOrResponse.id, body);

    return NextResponse.json<UserStoryResponse>(
      {
        success: true,
        data: userStory,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating user story:", error);
    const message = error instanceof Error ? error.message : "Failed to create user story";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("required")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
