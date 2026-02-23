import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { updateFeature, deleteFeature } from "@/services/roadmap";
import { getSystemAssigneeUser } from "@/lib/system-assignees";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;

    // Look up feature's workspaceId for API token auth
    const featureLookup = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });
    const userOrResponse = await requireAuthOrApiToken(request, featureLookup?.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    // Get sort parameter from query string, default to updatedAt
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get("sortBy") || "updatedAt";

    // Validate sortBy parameter
    const validSortFields = ["createdAt", "updatedAt", "order"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "updatedAt";

    // Determine sort order based on field
    const sortOrder = sortField === "order" ? "asc" : "desc";

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
                userId: userOrResponse.id,
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
        phases: {
          where: {
            deleted: false,
          },
          orderBy: {
            order: "asc",
          },
          include: {
            tasks: {
              where: {
                deleted: false,
              },
              orderBy: {
                [sortField]: sortOrder,
              },
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                order: true,
                featureId: true,
                phaseId: true,
                deleted: true,
                createdAt: true,
                updatedAt: true,
                systemAssigneeType: true,
                dependsOnTaskIds: true,
                bountyCode: true,
                autoMerge: true,
                deploymentStatus: true,
                deployedToStagingAt: true,
                deployedToProductionAt: true,
                assignee: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                repository: {
                  select: {
                    id: true,
                    name: true,
                    repositoryUrl: true,
                  },
                },
              },
            },
          },
        },
        tasks: {
          where: {
            phaseId: null,
            deleted: false,
          },
          orderBy: {
            [sortField]: sortOrder,
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            order: true,
            featureId: true,
            phaseId: true,
            deleted: true,
            createdAt: true,
            updatedAt: true,
            systemAssigneeType: true,
            dependsOnTaskIds: true,
            bountyCode: true,
            autoMerge: true,
            deploymentStatus: true,
            deployedToStagingAt: true,
            deployedToProductionAt: true,
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              },
            },
            repository: {
              select: {
                id: true,
                name: true,
                repositoryUrl: true,
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
    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Transform system assignees to virtual user objects
    const transformedFeature = {
      ...feature,
      phases: feature.phases.map(phase => ({
        ...phase,
        tasks: phase.tasks.map(task => {
          if (task.systemAssigneeType && !task.assignee) {
            return {
              ...task,
              assignee: getSystemAssigneeUser(task.systemAssigneeType),
            };
          }
          return task;
        }),
      })),
      tasks: feature.tasks.map(task => {
        if (task.systemAssigneeType && !task.assignee) {
          return {
            ...task,
            assignee: getSystemAssigneeUser(task.systemAssigneeType),
          };
        }
        return task;
      }),
    };

    return NextResponse.json(
      {
        success: true,
        data: transformedFeature,
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
    const { featureId } = await params;
    const body = await request.json();

    const featureLookup = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });
    const userOrResponse = await requireAuthOrApiToken(request, featureLookup?.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const updatedFeature = await updateFeature(featureId, userOrResponse.id, body);

    return NextResponse.json(
      {
        success: true,
        data: updatedFeature,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating feature:", error);
    const message = error instanceof Error ? error.message : "Failed to update feature";
    const status = message.includes("Feature not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("Invalid") || message.includes("required") || message.includes("Assignee not found") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;

    const featureLookup = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });
    const userOrResponse = await requireAuthOrApiToken(request, featureLookup?.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    await deleteFeature(featureId, userOrResponse.id);

    return NextResponse.json(
      {
        success: true,
        message: "Feature deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting feature:", error);
    const message = error instanceof Error ? error.message : "Failed to delete feature";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
