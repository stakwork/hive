import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { dropPod, getPodFromPool, updatePodRepositories, POD_PORTS } from "@/lib/pods";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const session = await auth();

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

    // Check for "latest" and "podId" query parameters
    const { searchParams } = new URL(request.url);
    const shouldResetRepositories = searchParams.get("latest") === "true";
    const podId = searchParams.get("podId");

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
