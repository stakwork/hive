import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import {
  releasePodById,
  getPodDetails,
  updatePodRepositories,
  releaseTaskPod,
  POD_PORTS,
  buildPodUrl,
} from "@/lib/pods";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;

    // Validate required fields
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing required field: workspaceId" }, { status: 400 });
    }

    // Check for "latest", "podId", and "taskId" query parameters
    const { searchParams } = new URL(request.url);
    const shouldResetRepositories = searchParams.get("latest") === "true";
    const podId = searchParams.get("podId");
    const taskId = searchParams.get("taskId");

    // podId is required - we must know which specific pod to drop
    if (!podId) {
      return NextResponse.json({ error: "Missing required field: podId" }, { status: 400 });
    }

    // Check for API token authentication (used by Stakwork/external services)
    const apiToken = request.headers.get("x-api-token");
    const isApiTokenAuth = apiToken && apiToken === process.env.API_TOKEN;

    if (!isApiTokenAuth) {
      // Fall back to session-based authentication
      const session = await getServerSession(authOptions);

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const userId = (session.user as { id?: string })?.id;
      if (!userId) {
        return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
      }

      // Verify user has access to the workspace
      const workspaceAccess = await db.workspace.findFirst({
        where: { id: workspaceId },
        include: {
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      });

      if (!workspaceAccess) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }

      const isOwner = workspaceAccess.ownerId === userId;
      const isMember = workspaceAccess.members.length > 0;

      if (!isOwner && !isMember) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // If taskId is provided, use the shared releaseTaskPod() function
    if (taskId) {
      const result = await releaseTaskPod({
        taskId,
        podId,
        workspaceId,
        verifyOwnership: true,
        resetRepositories: shouldResetRepositories,
        clearTaskFields: true,
        newWorkflowStatus: "COMPLETED",
      });

      if (result.reassigned) {
        return NextResponse.json(
          { error: "Pod has been reassigned to another task", reassigned: true, taskCleared: result.taskCleared },
          { status: 409 },
        );
      }

      if (!result.success && result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json(
        {
          success: true,
          message: "Pod dropped successfully",
          taskCleared: result.taskCleared,
        },
        { status: 200 },
      );
    }

    // No taskId provided - drop pod directly without task cleanup
    // This is for cases where we just want to release a pod without task association

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json({ success: true, message: "Pod dropped successfully" }, { status: 200 });
    }

    // Fetch workspace with swarm and repositories
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    console.log(">>> Dropping pod with ID:", podId);

    // If "latest" parameter is provided, reset the pod repositories before dropping
    if (shouldResetRepositories) {
      const podDetails = await getPodDetails(podId);

      if (!podDetails) {
        return NextResponse.json({ error: "Pod not found" }, { status: 404 });
      }

      const controlPort = parseInt(POD_PORTS.CONTROL, 10);
      const hasControlPort = podDetails.portMappings?.includes(controlPort) ?? false;

      if (!hasControlPort) {
        console.error(`Control port (${POD_PORTS.CONTROL}) not found in port mappings, skipping repository reset`);
      } else {
        try {
          const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));

          if (repositories.length > 0) {
            const controlPortUrl = buildPodUrl(podDetails.podId, POD_PORTS.CONTROL);
            const password = podDetails.password;
            await updatePodRepositories(controlPortUrl, password, repositories);
          } else {
            console.log(">>> No repositories to reset");
          }
        } catch (error) {
          console.error("Error resetting pod repositories:", error);
        }
      }
    }

    // Drop the pod using database query
    await releasePodById(podId);

    return NextResponse.json(
      {
        success: true,
        message: "Pod dropped successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error dropping pod:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to drop pod" }, { status: 500 });
  }
}
