import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { updateFeature, deleteFeature } from "@/services/roadmap";
import { getSystemAssigneeUser } from "@/lib/system-assignees";
import { extractPrArtifact } from "@/lib/helpers/tasks";
import { TaskStatus } from "@prisma/client";

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  workflowStatus: true,
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
  chatMessages: {
    select: {
      artifacts: {
        where: { type: "PULL_REQUEST" as const },
        select: {
          id: true,
          type: true,
          content: true,
        },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
    },
  },
} as const;

function getErrorStatus(message: string): number {
  if (message.includes("Invalid") || message.includes("required") || message.includes("Assignee not found")) return 400;
  if (message.includes("denied")) return 403;
  if (message.includes("not found") || message.includes("Feature not found")) return 404;
  return 500;
}

export async function GET(
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

    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get("sortBy") || "updatedAt";
    const validSortFields = ["createdAt", "updatedAt", "order"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "updatedAt";
    const sortOrder = sortField === "order" ? "asc" : "desc";

    const feature = await db.feature.findUnique({
      where: { id: featureId },
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
              where: { deleted: false },
              orderBy: { [sortField]: sortOrder },
              select: TASK_SELECT,
            },
          },
        },
        tasks: {
          where: { phaseId: null, deleted: false },
          orderBy: { [sortField]: sortOrder },
          select: TASK_SELECT,
        },
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const processTasks = async (tasks: typeof feature.phases[0]["tasks"]) => {
      return Promise.all(
        tasks.map(async (task) => {
          const prArtifact = await extractPrArtifact(task, userOrResponse.id);
          if (prArtifact?.content?.status === "DONE") {
            task.status = TaskStatus.DONE;
          }
          const { chatMessages: _, ...taskWithoutMessages } = task;
          const assignee = task.systemAssigneeType && !task.assignee
            ? getSystemAssigneeUser(task.systemAssigneeType)
            : task.assignee;
          return { ...taskWithoutMessages, assignee, prArtifact };
        })
      );
    };

    const transformedFeature = {
      ...feature,
      phases: await Promise.all(
        feature.phases.map(async (phase) => ({
          ...phase,
          tasks: await processTasks(phase.tasks),
        }))
      ),
      tasks: await processTasks(feature.tasks as typeof feature.phases[0]["tasks"]),
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
    return NextResponse.json({ error: message }, { status: getErrorStatus(message) });
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
    return NextResponse.json({ error: message }, { status: getErrorStatus(message) });
  }
}
