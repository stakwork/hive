import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { updateFeature, deleteFeature } from "@/services/roadmap";
import {
  notifyFeatureReassignmentRefresh,
  notifyFeatureContentRefresh,
} from "@/lib/canvas";
import { getSystemAssigneeUser } from "@/lib/system-assignees";
import { extractPrArtifact } from "@/lib/helpers/tasks";
import { TaskStatus } from "@prisma/client";
import { pusherServer, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { resolveWorkspaceAccess, requireReadAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser } from "@/lib/auth/public-redact";

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
  runBuild: true,
  runTestSuite: true,
  model: true,
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
    if (!featureLookup) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    // Resolve caller access against the workspace. Both authenticated
    // members and public-viewers on `isPublicViewable` workspaces are
    // allowed read access; everyone else gets a unified 404.
    //
    // We still go through `requireAuthOrApiToken` so that requests bearing
    // a valid `x-api-token` header are accepted (service-to-service
    // callers with no session). That path assumes the workspace owner as
    // the acting user and bypasses membership — `requireAuthOrApiToken`
    // only returns an owner-user when the token itself is valid, so the
    // bypass is limited to trusted clients.
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;
    let userId: string | null = null;
    let redactForPublic = false;

    if (apiTokenAuth) {
      const apiResult = await requireAuthOrApiToken(request, featureLookup.workspaceId);
      if (apiResult instanceof NextResponse) return apiResult;
      userId = apiResult.id;
    } else {
      const rawAccess = await resolveWorkspaceAccess(request, {
        workspaceId: featureLookup.workspaceId,
      });
      const access = requireReadAccess(rawAccess);
      if (access instanceof NextResponse) return access;
      userId = access.userId ?? null;
      redactForPublic = isPublicViewer(access);

    }

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

    // Access already validated above (either authenticated member or
    // public-viewer on an isPublicViewable workspace). No further check
    // needed here.

    const processTasks = async (tasks: typeof feature.phases[0]["tasks"]) => {
      return Promise.all(
        tasks.map(async (task) => {
          // Public viewers have no GitHub token — skip the live PR status
          // refresh and use the stored artifact state.
          const prArtifact = userId
            ? await extractPrArtifact(task, userId)
            : null;
          if (prArtifact?.content?.status === "DONE") {
            task.status = TaskStatus.DONE;
          }
          const { chatMessages: _, ...taskWithoutMessages } = task;
          const rawAssignee = task.systemAssigneeType && !task.assignee
            ? getSystemAssigneeUser(task.systemAssigneeType)
            : task.assignee;
          const assignee = redactForPublic ? toPublicUser(rawAssignee) : rawAssignee;
          return { ...taskWithoutMessages, assignee, prArtifact };
        })
      );
    };

    const transformedFeature = {
      ...feature,
      assignee: redactForPublic ? toPublicUser(feature.assignee) : feature.assignee,
      createdBy: redactForPublic ? toPublicUser(feature.createdBy) : feature.createdBy,
      updatedBy: redactForPublic ? toPublicUser(feature.updatedBy) : feature.updatedBy,
      userStories: redactForPublic
        ? feature.userStories.map((s) => ({
            ...s,
            createdBy: toPublicUser(s.createdBy),
            updatedBy: toPublicUser(s.updatedBy),
          }))
        : feature.userStories,
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

    // Snapshot the feature's canvas anchors BEFORE the update so we can
    // fan out CANVAS_UPDATED on both the canvas the feature left AND
    // the one it landed on. We need this for the drag-and-drop
    // assignment path (consumer PATCHes `milestoneId`), but pulling it
    // here keeps the route's contract identical for callers that
    // aren't touching anchors — `notifyFeatureReassignmentRefresh` is
    // only fired when at least one anchor field appears in the body.
    const featureLookup = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        workspaceId: true,
        milestoneId: true,
        initiativeId: true,
      },
    });
    const userOrResponse = await requireAuthOrApiToken(request, featureLookup?.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const updatedFeature = await updateFeature(featureId, userOrResponse.id, body);

    // Broadcast title update via Pusher if title was changed
    if (body.title && typeof body.title === "string" && body.title.trim()) {
      try {
        await pusherServer.trigger(
          getFeatureChannelName(featureId),
          PUSHER_EVENTS.FEATURE_TITLE_UPDATE,
          { featureId, newTitle: body.title.trim() }
        );
      } catch (pusherError) {
        console.error("Failed to broadcast feature title update:", pusherError);
      }

      // The org canvas projects feature cards with `text = Feature.title`,
      // so a rename needs a CANVAS_UPDATED fan-out on every canvas the
      // feature renders on (workspace for loose, initiative for anchored,
      // root for the rollup). Skip when anchors also changed — the
      // reassignment fan-out below is a strict superset.
      if (body.milestoneId === undefined && body.initiativeId === undefined) {
        void notifyFeatureContentRefresh(featureId, "feature-title-renamed");
      }
    }

    // Canvas reassignment fan-out. Only fires when the body actually
    // touched a canvas anchor — covers drag-and-drop on the org canvas
    // (milestone reassign), board moves, and any future API caller that
    // moves a feature between initiative/milestone scopes. The helper
    // resolves both `before` and `after` refs and emits CANVAS_UPDATED
    // on every affected canvas (root, both initiatives, both milestones,
    // workspace) with sensible de-duping. Fire-and-forget — Pusher
    // hiccups must not fail the PATCH that triggered them.
    if (
      featureLookup &&
      (body.milestoneId !== undefined || body.initiativeId !== undefined)
    ) {
      void notifyFeatureReassignmentRefresh(featureId, {
        milestoneId: featureLookup.milestoneId,
        initiativeId: featureLookup.initiativeId,
        workspaceId: featureLookup.workspaceId,
      });
    }

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
