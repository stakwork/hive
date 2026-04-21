import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { FeatureStatus } from "@prisma/client";
import { getSystemAssigneeUser } from "@/lib/system-assignees";
import type { BoardFeature, BoardResponse } from "@/types/roadmap";
import { resolveWorkspaceAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser } from "@/lib/auth/public-redact";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    // Auth: x-api-token callers are trusted service-to-service clients that
    // bypass membership. Everyone else is resolved through
    // `resolveWorkspaceAccess`, which enforces workspace membership (or
    // public-viewer on `isPublicViewable` workspaces). `requireAuthOrApiToken`
    // alone is not sufficient — it accepts any authenticated user without
    // checking workspace membership, which would leak board data across
    // tenants.
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;
    let redactForPublic = false;

    if (apiTokenAuth) {
      const apiResult = await requireAuthOrApiToken(request, workspaceId);
      if (apiResult instanceof NextResponse) return apiResult;
    } else {
      const access = await resolveWorkspaceAccess(request, { workspaceId });
      if (!access) {
        return NextResponse.json(
          { error: "Workspace not found or access denied" },
          { status: 404 },
        );
      }
      redactForPublic = isPublicViewer(access);
    }

    // Status filter (optional, comma-separated)
    const statusParam = searchParams.get("status") || undefined;
    let statuses: FeatureStatus[] | undefined;

    if (statusParam) {
      const statusValues = statusParam.split(",").filter(Boolean);
      const validStatuses = Object.values(FeatureStatus);
      const invalidStatuses = statusValues.filter(
        (s) => !validStatuses.includes(s as FeatureStatus),
      );
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          { error: `Invalid status values: ${invalidStatuses.join(", ")}` },
          { status: 400 },
        );
      }
      statuses = statusValues as FeatureStatus[];
    }

    // Default: exclude CANCELLED features unless explicitly requested
    const statusFilter: FeatureStatus[] = statuses ?? [
      FeatureStatus.BACKLOG,
      FeatureStatus.PLANNED,
      FeatureStatus.IN_PROGRESS,
      FeatureStatus.COMPLETED,
      FeatureStatus.BLOCKED,
      FeatureStatus.ERROR,
    ];

    const features = await db.feature.findMany({
      where: {
        workspaceId,
        deleted: false,
        status: { in: statusFilter },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        tasks: {
          where: {
            deleted: false,
            archived: false,
          },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dependsOnTaskIds: true,
            featureId: true,
            systemAssigneeType: true,
            order: true,
            description: true,
            phaseId: true,
            workspaceId: true,
            bountyCode: true,
            autoMerge: true,
            runBuild: true,
            runTestSuite: true,
            deploymentStatus: true,
            deployedToStagingAt: true,
            deployedToProductionAt: true,
            workflowStatus: true,
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
            repository: {
              select: {
                id: true,
                name: true,
                repositoryUrl: true,
              },
            },
            phase: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Transform tasks to include icon on assignee (system assignee support)
    const boardFeatures: BoardFeature[] = features.map((feature) => ({
      ...feature,
      tasks: feature.tasks.map((task) => {
        let assignee = task.assignee
          ? { ...task.assignee, icon: null as string | null }
          : null;

        if (task.systemAssigneeType) {
          const systemUser = getSystemAssigneeUser(task.systemAssigneeType);
          if (systemUser) {
            assignee = {
              id: systemUser.id,
              name: systemUser.name,
              email: null,
              image: systemUser.image,
              icon: systemUser.icon ?? null,
            };
          }
        }

        if (redactForPublic && assignee) {
          // Preserve icon (used for system assignees) while stripping email.
          const safe = toPublicUser(assignee);
          assignee = safe ? { ...safe, email: null, icon: assignee.icon } : null;
        }

        return {
          ...task,
          assignee,
          prArtifact: undefined,
        };
      }),
    }));

    return NextResponse.json<BoardResponse>(
      { success: true, data: boardFeatures },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching board features:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch board features";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
