import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { TaskSourceType } from "@prisma/client";
import { getWorkspaceById } from "@/services/workspace";
import { type StakworkWorkflowPayload } from "@/app/api/chat/message/route";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

async function callStakwork(
  message: string,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  repo2GraphUrl: string,
  accessToken: string | null,
  username: string | null,
  workspaceId: string,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    // stakwork workflow vars
    const vars = {
      message,
      accessToken,
      username,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      workspaceId,
    };

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(config.STAKWORK_USER_JOURNEY_WORKFLOW_ID),
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to send message to Stakwork: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = await request.json();
    const { message, workspaceId, title, description, testName } = body;

    // Validate required fields
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace ID is required" }, { status: 400 });
    }

    // Use default title if not provided
    const taskTitle = title || testName || "User Journey Test";

    // Find the workspace and validate user access
    const workspace = await getWorkspaceById(workspaceId, userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    // Get workspace slug for GitHub credentials
    const workspaceData = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true }
    });

    if (!workspaceData) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Get user's GitHub profile (access token and username)
    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceData.slug);
    const accessToken = githubProfile?.token || null;
    const username = githubProfile?.username || null;

    // Find the swarm associated with this workspace
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        swarmUrl: true,
        swarmSecretAlias: true,
        poolName: true,
      },
    });

    if (!swarm) {
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";

    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.poolName || swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    let stakworkData = null;

    stakworkData = await callStakwork(
      message,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2GraphUrl,
      accessToken,
      username,
      workspaceId,
    );

    // Create a task to track this user journey test
    // This allows filtering, viewing, and managing E2E tests alongside other tasks
    // The test code itself is stored in the graph; this task tracks metadata and status
    let task = null;
    try {
      // Use the user's chosen filename directly, or provide a default
      // The filename is provided by the browser artifact panel when the user saves the test
      const testFilePath = testName
        ? `src/__tests__/e2e/specs/${testName}`
        : `src/__tests__/e2e/specs/user-journey-test.spec.ts`;

      // Get workspace's primary repository if available
      const repository = await db.repository.findFirst({
        where: { workspaceId: workspace.id },
        select: { id: true, repositoryUrl: true, branch: true },
      });

      // Extract stakworkProjectId from response if Stakwork succeeded
      const stakworkProjectId = (stakworkData?.success && stakworkData?.data)
        ? (stakworkData.data.project_id || stakworkData.data.id || null)
        : null;

      // Determine workflow status based on Stakwork success
      const workflowStatus = stakworkProjectId ? "PENDING" : null;

      // Create task record
      task = await db.task.create({
        data: {
          title: taskTitle,
          description: description || `User journey test: ${taskTitle}`,
          workspaceId: workspace.id,
          sourceType: TaskSourceType.USER_JOURNEY,
          status: "IN_PROGRESS",
          workflowStatus: workflowStatus,
          priority: "MEDIUM",
          testFilePath,
          testFileUrl: repository?.repositoryUrl
            ? `${repository.repositoryUrl}/blob/${repository.branch || 'main'}/${testFilePath}`
            : null,
          stakworkProjectId: stakworkProjectId ? parseInt(String(stakworkProjectId)) : null,
          repositoryId: repository?.id || null,
          createdById: userId,
          updatedById: userId,
        },
        select: {
          id: true,
          title: true,
          status: true,
          workflowStatus: true,
          testFilePath: true,
          stakworkProjectId: true,
        },
      });

      // Save test code in ChatMessage for immediate replay access
      // This makes the test code available instantly without waiting for Stakwork processing
      // Using ASSISTANT role since test code is system-generated content
      try {
        await db.chatMessage.create({
          data: {
            taskId: task.id,
            role: "ASSISTANT",
            message: message, // Store the test code
            timestamp: new Date(),
          },
        });
      } catch (error) {
        console.error("Error saving test code to ChatMessage:", error);
        // Non-fatal - task was still created successfully
      }

      if (!stakworkProjectId) {
        console.warn("Task created without stakworkProjectId (Stakwork call failed)");
      }
    } catch (error) {
      console.error("Error creating task for user journey:", error);
      // Continue anyway - we still want to return the Stakwork response
    }

    return NextResponse.json(
      {
        success: true,
        message: "called stakwork",
        workflow: stakworkData?.data || null,
        task: task || null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating chat message:", error);
    return NextResponse.json({ error: "Failed to create chat message" }, { status: 500 });
  }
}
