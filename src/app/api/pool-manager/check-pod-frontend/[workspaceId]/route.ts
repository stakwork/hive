import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getProcessList, checkFrontendRunning, POD_PORTS } from "@/lib/pods";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
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

    // Get podId from query parameters
    const { searchParams } = new URL(request.url);
    const podId = searchParams.get("podId");

    if (!podId) {
      return NextResponse.json({ error: "Missing required query parameter: podId" }, { status: 400 });
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
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
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

    // Check if swarm has pool configuration
    if (!workspace.swarm.id || !workspace.swarm.poolApiKey) {
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolApiKey = workspace.swarm.poolApiKey;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    // Get pod information from pool manager
    const { getPodFromPool } = await import("@/lib/pods");
    const podWorkspace = await getPodFromPool(podId, poolApiKeyPlain);

    // Get the control port URL
    const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];
    if (!controlPortUrl) {
      return NextResponse.json(
        { error: `Control port (${POD_PORTS.CONTROL}) not found in port mappings` },
        { status: 500 },
      );
    }

    // Get the process list from the control port
    const processList = await getProcessList(controlPortUrl, podWorkspace.password);

    // Check if frontend is running
    const isReady = checkFrontendRunning(processList);

    console.log(`🔍 Frontend status for pod ${podId}: ${isReady ? "READY" : "NOT READY"}`);

    return NextResponse.json(
      {
        success: true,
        isReady,
        podId,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error checking frontend status:", error);
    return NextResponse.json(
      {
        error: "Failed to check frontend status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
