import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

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

    const feature = await db.feature.findUnique({
      where: {
        id: featureId,
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
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
        },
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
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        userStories: {
          orderBy: {
            order: "asc",
          },
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            updatedBy: {
              select: {
                id: true,
                name: true,
                email: true,
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

    // Check if user is workspace owner or member
    const isOwner = feature.workspace.ownerId === userId;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: true,
        data: feature,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching feature:", error);
    return NextResponse.json(
      { error: "Failed to fetch feature" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const { title, status, priority, assigneeId, brief, requirements, architecture } = body;

    // Fetch the feature with workspace info
    const feature = await db.feature.findUnique({
      where: {
        id: featureId,
      },
      select: {
        id: true,
        workspace: {
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
        },
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    // Check if user is workspace owner or member
    const isOwner = feature.workspace.ownerId === userId;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate status if provided
    if (status && !Object.values(FeatureStatus).includes(status as FeatureStatus)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${Object.values(FeatureStatus).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (priority && !Object.values(FeaturePriority).includes(priority as FeaturePriority)) {
      return NextResponse.json(
        {
          error: `Invalid priority. Must be one of: ${Object.values(FeaturePriority).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate assignee exists if provided
    if (assigneeId !== undefined && assigneeId !== null) {
      const assignee = await db.user.findFirst({
        where: {
          id: assigneeId,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Assignee not found" },
          { status: 400 }
        );
      }
    }

    // Build update data object
    const updateData: any = {
      updatedBy: {
        connect: {
          id: userId,
        },
      },
    };

    if (title !== undefined) {
      updateData.title = title.trim();
    }
    if (brief !== undefined) {
      updateData.brief = brief?.trim() || null;
    }
    if (requirements !== undefined) {
      updateData.requirements = requirements?.trim() || null;
    }
    if (architecture !== undefined) {
      updateData.architecture = architecture?.trim() || null;
    }
    if (status !== undefined) {
      updateData.status = status as FeatureStatus;
    }
    if (priority !== undefined) {
      updateData.priority = priority as FeaturePriority;
    }
    if (assigneeId !== undefined) {
      if (assigneeId === null) {
        updateData.assignee = { disconnect: true };
      } else {
        updateData.assignee = { connect: { id: assigneeId } };
      }
    }

    // Update the feature
    const updatedFeature = await db.feature.update({
      where: {
        id: featureId,
      },
      data: updateData,
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
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
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        userStories: {
          orderBy: {
            order: "asc",
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedFeature,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating feature:", error);
    return NextResponse.json(
      { error: "Failed to update feature" },
      { status: 500 }
    );
  }
}
