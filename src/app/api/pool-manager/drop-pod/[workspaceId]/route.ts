import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { dropPod, getPodFromPool, getPodUsage, updatePodRepositories, POD_PORTS } from "@/lib/pods";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

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

    // Verify user has access to the workspace
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: {
          where: { userId },
          select: { role: true },
        },
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json({ success: true, message: "Pod dropped successfully" }, { status: 200 });
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    const poolApiKey = workspace.swarm.poolApiKey;

    // Check if swarm has pool configuration
    if (!workspace.swarm.id || !poolApiKey) {
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolId = workspace.swarm.id || workspace.swarm.poolName;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    console.log(">>> Dropping pod with ID:", podId);

    // If taskId is provided, verify the pod is still assigned to this task
    // This prevents releasing a pod that has been reassigned to another task
    if (taskId) {
      try {
        const podUsage = await getPodUsage(poolId as string, podId, poolApiKeyPlain);

        if (podUsage.user_info !== taskId) {
          console.log(`>>> Pod ${podId} user_info (${podUsage.user_info}) does not match taskId (${taskId})`);

          // Clear stale reference from this task (but don't drop the pod - it belongs to another task)
          try {
            await db.task.update({
              where: { id: taskId },
              data: {
                podId: null,
                agentUrl: null,
                agentPassword: null,
                workflowStatus: "COMPLETED",
              },
            });
            console.log(`>>> Cleared stale pod fields for task ${taskId}`);
          } catch (updateError) {
            console.error("Error clearing stale task pod fields:", updateError);
          }

          return NextResponse.json(
            { error: "Pod has been reassigned to another task", reassigned: true, taskCleared: true },
            { status: 409 },
          );
        }

        console.log(`>>> Pod ${podId} ownership verified for task ${taskId}`);
      } catch (error) {
        console.error("Error verifying pod ownership:", error);
        return NextResponse.json({ error: "Failed to verify pod ownership" }, { status: 500 });
      }
    }

    // If "latest" parameter is provided, reset the pod repositories before dropping
    if (shouldResetRepositories) {
      // Fetch workspace details to get port mappings and password
      const podWorkspace = await getPodFromPool(podId, poolApiKeyPlain);
      const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

      if (!controlPortUrl) {
        console.error(`Control port (${POD_PORTS.CONTROL}) not found in port mappings, skipping repository reset`);
      } else {
        try {
          const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));

          if (repositories.length > 0) {
            await updatePodRepositories(controlPortUrl, podWorkspace.password, repositories);
          } else {
            console.log(">>> No repositories to reset");
          }
        } catch (error) {
          console.error("Error resetting pod repositories:", error);
        }
      }
    }

    // Now drop the pod
    await dropPod(poolId as string, podId, poolApiKeyPlain);

    // If taskId was provided, clear the pod-related fields on the task and mark workflow as completed
    let taskCleared = false;
    if (taskId) {
      try {
        await db.task.update({
          where: { id: taskId },
          data: {
            podId: null,
            agentUrl: null,
            agentPassword: null,
            workflowStatus: "COMPLETED",
          },
        });
        taskCleared = true;
        console.log(`>>> Cleared pod fields and set workflowStatus to COMPLETED for task ${taskId}`);
      } catch (error) {
        console.error("Error clearing task pod fields:", error);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: "Pod dropped successfully",
        ...(taskId && { taskCleared }),
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
