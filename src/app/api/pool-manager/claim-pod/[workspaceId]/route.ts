import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { type ApiError } from "@/types";
import {
  claimAvailablePodAndSetup,
  claimTaskPodAndSetup,
  updatePodRepositories,
  POD_PORTS,
} from "@/lib/pods";
import { POD_BASE_DOMAIN } from "@/lib/pods/queries";
import { requireAuthOrApiToken, validateApiToken } from "@/lib/auth/api-token";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;

    // Validate required fields
    if (!workspaceId) {
      return NextResponse.json({ success: false, error: "Missing required field: workspaceId" }, { status: 400 });
    }

    // Check for API token authentication (used by Stakwork/external services)
    const isApiTokenAuth = validateApiToken(request);

    let userId: string | undefined;

    if (!isApiTokenAuth) {
      // Authenticate via session cookie (web UI) or Bearer token (iOS app)
      const userOrResponse = await requireAuthOrApiToken(request, workspaceId);
      if (userOrResponse instanceof NextResponse) {
        return userOrResponse;
      }
      userId = userOrResponse.id;
    }

    // Check for "latest" and "taskId" query parameters
    const { searchParams } = new URL(request.url);
    const shouldUpdateToLatest = searchParams.get("latest") === "true";
    const taskId = searchParams.get("taskId");

    // Fetch workspace (include members filter only when we have a userId for ownership check)
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: userId
          ? { where: { userId }, select: { role: true } }
          : { select: { role: true }, take: 0 },
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });
    }

    // If using custom local Goose URL, return mock URLs instead of claiming a real pod
    if (process.env.CUSTOM_GOOSE_URL) {
      const mockFrontend = process.env.MOCK_BROWSER_URL || "http://localhost:3000";
      const mockPodId = "local-dev";

      // Store custom agent details without creating a fake pod/task link.
      if (taskId) {
        try {
          await db.task.update({
            where: { id: taskId },
            data: {
              agentUrl: process.env.CUSTOM_GOOSE_URL,
              agentPassword: null,
            },
          });
          console.log(`✅ Stored custom agent URL for task ${taskId}`);
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
    );

    // Enforce ownership check only for session-based auth (API token callers are trusted system actors)
    if (!isApiTokenAuth) {
      const isOwner = workspace.ownerId === userId;
      const isMember = workspace.members.length > 0;

      if (!isOwner && !isMember) {
        return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
      }
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json({ success: false, error: "No swarm found for this workspace" }, { status: 404 });
    }

    // Check if swarm has pool configuration
    // Claim pod from database
    const swarmId = workspace.swarm?.id;

    if (!swarmId) {
      return NextResponse.json({ success: false, error: "Workspace has no swarm configured" }, { status: 400 });
    }

    // Get services from swarm
    const services = workspace.swarm.services as
      | Array<{ name: string; port: number; scripts?: Record<string, string> }>
      | null
      | undefined;

    let frontend: string;
    let control: string | null;
    let ide: string | null;
    let podWorkspace: Awaited<ReturnType<typeof claimAvailablePodAndSetup>>["workspace"];
    if (taskId) {
      const result = await claimTaskPodAndSetup({
        taskId,
        swarmId,
        services: services || undefined,
        repositories: workspace.repositories.map((repo) => ({ url: repo.repositoryUrl })),
        refreshRepositories: shouldUpdateToLatest,
        requireControlPort: true,
      });

      if (!result) {
        return NextResponse.json(
          { success: false, error: "Task already has a pod assigned" },
          { status: 409 },
        );
      }

      frontend = result.frontend;
      podWorkspace = result.workspace;
      control = result.control;
      ide = result.ide;
    } else {
      const result = await claimAvailablePodAndSetup({
        swarmId,
        services: services || undefined,
      });
      frontend = result.frontend;
      podWorkspace = result.workspace;
      control = result.control;
      ide = result.ide;
    }

    // If "latest" parameter is provided, update the pod repositories
    if (shouldUpdateToLatest && !taskId) {
      const controlPortUrl = control;

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

    const pod_url = `https://${podWorkspace.id}.${POD_BASE_DOMAIN}`;

    console.log(">>> control", control);

    return NextResponse.json(
      {
        success: true,
        message: "Pod claimed successfully",
        podId: podWorkspace.id,
        pod_url,
        frontend,
        control,
        ide,
        password: podWorkspace.password,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error claiming pod:", error);

    // No pods available — capacity issue, not a server error
    if (error instanceof Error && error.message.includes("No available pods")) {
      return NextResponse.json(
        { success: false, error: "No available pods" },
        { status: 503 },
      );
    }

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          success: false,
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ success: false, error: "Failed to claim pod" }, { status: 500 });
  }
}
