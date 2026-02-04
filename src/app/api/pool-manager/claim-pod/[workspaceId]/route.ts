import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { claimPodAndGetFrontend, updatePodRepositories, POD_PORTS } from "@/lib/pods";

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

    // Check for "latest", "goose", and "taskId" query parameters
    const { searchParams } = new URL(request.url);
    const shouldUpdateToLatest = searchParams.get("latest") === "true";
    const shouldIncludeGoose = searchParams.get("goose") === "true";
    const taskId = searchParams.get("taskId");

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

    // If using custom local Goose URL, return mock URLs instead of claiming a real pod
    if (process.env.CUSTOM_GOOSE_URL) {
      const mockFrontend = process.env.MOCK_BROWSER_URL || "http://localhost:3000";
      const mockPodId = "local-dev";

      // Still save podId and agentUrl to task in dev mode
      if (taskId && shouldIncludeGoose) {
        try {
          await db.task.update({
            where: { id: taskId },
            data: {
              podId: mockPodId,
              agentUrl: process.env.CUSTOM_GOOSE_URL,
            },
          });
          console.log(`✅ Stored mock podId ${mockPodId} for task ${taskId}`);
        } catch (error) {
          console.error("Failed to store mock pod info:", error);
        }
      }

      return NextResponse.json(
        {
          success: true,
          message: "Using local Goose instance (no pod claimed)",
          podId: mockPodId,
          frontend: mockFrontend,
          control: null,
          ide: null,
          goose: process.env.CUSTOM_GOOSE_URL,
        },
        { status: 200 },
      );
    }

    // Legacy mock for testing browser URL only
    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json(
        { success: true, message: "Pod claimed successfully", frontend: process.env.MOCK_BROWSER_URL },
        { status: 200 },
      );
    }

    console.log(
      "🔍 Claim pod for real: workspaceId:",
      workspaceId,
      "shouldUpdateToLatest:",
      shouldUpdateToLatest,
      "shouldIncludeGoose:",
      shouldIncludeGoose,
    );

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
    // Claim pod from database
    const swarmId = workspace.swarm?.id;
    
    if (!swarmId) {
      return NextResponse.json({ error: "Workspace has no swarm configured" }, { status: 400 });
    }

    // Get services from swarm
    const services = workspace.swarm.services as
      | Array<{ name: string; port: number; scripts?: Record<string, string> }>
      | null
      | undefined;

    const {
      frontend,
      workspace: podWorkspace,
    } = await claimPodAndGetFrontend(swarmId, userId, services || undefined);

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

    console.log(">>> control", control);

    // If taskId is provided, store agent credentials and podId on the task
    // Use control URL (staklink on port 15552) for agentUrl since /session endpoint is there
    if (taskId && shouldIncludeGoose && control) {
      try {
        const encryptedPassword = encryptionService.encryptField("agentPassword", podWorkspace.password);

        await db.task.update({
          where: { id: taskId },
          data: {
            podId: podWorkspace.id,
            agentUrl: control,
            agentPassword: JSON.stringify(encryptedPassword),
          },
        });

        console.log(`✅ Stored podId ${podWorkspace.id} and agent credentials for task ${taskId}`);
      } catch (error) {
        console.error("Failed to store pod info:", error);
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
        // goose URL and password are NOT returned (stored in DB)
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
