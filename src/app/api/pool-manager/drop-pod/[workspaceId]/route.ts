import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { dropPod, getWorkspaceFromPool, updatePodRepositories } from "@/lib/pods";

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

    // Check for "latest" query parameter
    const { searchParams } = new URL(request.url);
    const shouldResetRepositories = searchParams.get("latest") === "true";

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
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json(
        { success: true, message: "Pod dropped successfully" },
        { status: 200 },
      );
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

    let poolApiKey = workspace.swarm.poolApiKey;
    const swarm = workspace.swarm;
    if (!swarm.poolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }

    // Check if swarm has pool configuration
    if (!workspace.swarm.poolName || !poolApiKey) {
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolName = workspace.swarm.poolName;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    const headers = {
      Authorization: `Bearer ${poolApiKeyPlain}`,
      "Content-Type": "application/json",
    };

    // First, get the workspace info to retrieve the external workspace ID
    const podWorkspace = await getWorkspaceFromPool(poolName, headers);

    // If "latest" parameter is provided, reset the pod repositories before dropping
    if (shouldResetRepositories) {
      const controlPortUrl = podWorkspace.portMappings["15552"];

      if (!controlPortUrl) {
        console.error("Control port (15552) not found in port mappings, skipping repository reset");
      } else {
        // Reset repositories to empty array
        await updatePodRepositories(controlPortUrl, podWorkspace.password, []);
      }
    }

    // Now drop the pod
    await dropPod(poolName, podWorkspace.id, headers);

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
