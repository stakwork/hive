import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error:
            "Invalid pagination parameters. Page must be >= 1, limit must be 1-100",
        },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: {
            userId: userId,
          },
          select: {
            role: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get features for the workspace with pagination
    const skip = (page - 1) * limit;

    const [features, totalCount] = await Promise.all([
      db.feature.findMany({
        where: {
          workspaceId,
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          _count: {
            select: {
              userStories: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      db.feature.count({
        where: {
          workspaceId,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    return NextResponse.json(
      {
        success: true,
        data: features,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasMore,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching features:", error);
    return NextResponse.json(
      { error: "Failed to fetch features" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { title, workspaceId, status, priority, assigneeId } = body;

    // Validate required fields
    if (!title || !workspaceId) {
      return NextResponse.json(
        { error: "Missing required fields: title, workspaceId" },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: {
            userId: userId,
          },
          select: {
            role: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Verify that the user exists in the database
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate and convert status if provided
    let featureStatus: FeatureStatus = FeatureStatus.BACKLOG; // default
    if (status) {
      if (Object.values(FeatureStatus).includes(status as FeatureStatus)) {
        featureStatus = status as FeatureStatus;
      } else {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${Object.values(FeatureStatus).join(", ")}`,
          },
          { status: 400 },
        );
      }
    }

    // Validate priority if provided
    let featurePriority: FeaturePriority = FeaturePriority.NONE; // default
    if (priority) {
      if (Object.values(FeaturePriority).includes(priority as FeaturePriority)) {
        featurePriority = priority as FeaturePriority;
      } else {
        return NextResponse.json(
          {
            error: `Invalid priority. Must be one of: ${Object.values(FeaturePriority).join(", ")}`,
          },
          { status: 400 },
        );
      }
    }

    // Validate assignee exists if provided
    if (assigneeId) {
      const assignee = await db.user.findFirst({
        where: {
          id: assigneeId,
          deleted: false,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Assignee not found" },
          { status: 400 },
        );
      }
    }

    // Create the feature
    const feature = await db.feature.create({
      data: {
        title: title.trim(),
        workspaceId,
        status: featureStatus,
        priority: featurePriority,
        assigneeId: assigneeId || null,
        createdById: userId,
        updatedById: userId,
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            userStories: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: feature,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating feature:", error);
    return NextResponse.json(
      { error: "Failed to create feature" },
      { status: 500 },
    );
  }
}
