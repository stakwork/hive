import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { claimPodAndGetFrontend, updatePodRepositories, startGoose, checkGooseRunning, POD_PORTS } from "@/lib/pods";

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

    // Check for "latest" and "goose" query parameters
    const { searchParams } = new URL(request.url);
    const shouldUpdateToLatest = searchParams.get("latest") === "true";
    const shouldIncludeGoose = searchParams.get("goose") === "true";

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
      return NextResponse.json(
        { success: true, message: "Pod claimed successfully", frontend: process.env.MOCK_BROWSER_URL },
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

    // Check if swarm has pool configuration
    if (!workspace.swarm.poolName || !workspace.swarm.poolApiKey) {
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolApiKey = workspace.swarm.poolApiKey;

    // Call Pool Manager API to claim pod
    const poolName = workspace.swarm.poolName;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    const { frontend, workspace: podWorkspace, processList } = await claimPodAndGetFrontend(poolName, poolApiKeyPlain);

    // If "latest" parameter is provided, update the pod repositories
    if (shouldUpdateToLatest) {
      const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

      if (!controlPortUrl) {
        console.error(`Control port (${POD_PORTS.CONTROL}) not found in port mappings, skipping repository update`);
      } else {
        const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));

        if (repositories.length > 0) {
          try {
            await updatePodRepositories(controlPortUrl, podWorkspace.password, repositories);
          } catch (error) {
            console.error("Error updating pod repositories:", error);
          }
        } else {
          console.log(">>> No repositories to update");
        }
      }
    }

    // Extract control, IDE, and goose URLs
    const control = podWorkspace.portMappings[POD_PORTS.CONTROL] || null;
    const ide = podWorkspace.url || null;

    // Only handle goose if requested via query parameter
    let goose: string | null = null;
    if (shouldIncludeGoose) {
      // Check if goose service is already running by checking process list
      const gooseIsRunning = processList ? checkGooseRunning(processList) : false;

      if (gooseIsRunning) {
        // Goose is always on the designated port
        goose = podWorkspace.portMappings[POD_PORTS.GOOSE] || null;
        if (goose) {
          console.log(`✅ Goose service already running on port ${POD_PORTS.GOOSE}:`, goose);
        }
      }

      // If goose service is not running, start it up via control port
      if (!goose && control) {
        // Get the first repository name (or default to "hive")
        const repoName = workspace.repositories[0]?.repositoryUrl.split("/").pop()?.replace(".git", "") || "hive";

        // Get Anthropic API key from environment
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!anthropicApiKey) {
          console.error("ANTHROPIC_API_KEY not found in environment");
        } else {
          goose = await startGoose(control, podWorkspace.password, repoName, anthropicApiKey, podWorkspace.portMappings);
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: "Pod claimed successfully",
        podId: podWorkspace.id,
        frontend,
        control,
        ide,
        goose,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error claiming pod:", error);

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

    return NextResponse.json({ error: "Failed to claim pod" }, { status: 500 });
  }
}
