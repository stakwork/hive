import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { TaskSourceType } from "@prisma/client";
import { getWorkspaceById } from "@/services/workspace";
import { type StakworkWorkflowPayload } from "@/types/stakwork";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getBaseUrl } from "@/lib/utils";

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
  taskId: string,
  testFilePath: string | null,
  testFileUrl: string | null,
  baseBranch: string | null,
  testName: string,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    // Generate webhook URLs
    const baseUrl = getBaseUrl();
    const webhookUrl = `${baseUrl}/api/chat/response`;
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // stakwork workflow vars
    const vars = {
      taskId,
      message,
      webhookUrl,
      accessToken,
      username,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      workspaceId,
      testFilePath,
      testFileUrl,
      baseBranch,
      testName,
    };

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(config.STAKWORK_USER_JOURNEY_WORKFLOW_ID),
      webhook_url: workflowWebhookUrl,
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

    // Get workspace's primary repository if available
    const repository = await db.repository.findFirst({
      where: { workspaceId: workspace.id },
      select: { id: true, repositoryUrl: true, branch: true },
    });

    // Don't create fake testFilePath - Stakwork workflow will determine the actual path
    // The path will be synced from the graph after the workflow completes
    const testFilePath = null;
    const testFileUrl = null;

    // Create a task FIRST to track this user journey test
    // This allows us to send the task ID to Stakwork so webhooks can update the task
    // The test code itself is stored in the graph; this task tracks metadata and status
    let task = null;
    try {
      // Create task record (stakworkProjectId will be updated after Stakwork call)
      task = await db.task.create({
        data: {
          title: taskTitle,
          description: description || `User journey test: ${taskTitle}`,
          workspaceId: workspace.id,
          sourceType: TaskSourceType.USER_JOURNEY,
          status: "TODO",
          workflowStatus: "PENDING",
          priority: "MEDIUM",
          testFilePath,
          testFileUrl,
          stakworkProjectId: null,
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
    } catch (error) {
      console.error("Error creating task for user journey:", error);
      return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
    }

    // Now call Stakwork with the task ID so webhooks can update the task
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
      task.id,
      testFilePath,
      testFileUrl,
      repository?.branch || 'main',
      testName || taskTitle,
    );

    // Update task with stakworkProjectId if Stakwork succeeded
    try {
      const stakworkProjectId = (stakworkData?.success && stakworkData?.data)
        ? (stakworkData.data.project_id || stakworkData.data.id || null)
        : null;

      if (stakworkProjectId) {
        await db.task.update({
          where: { id: task.id },
          data: {
            stakworkProjectId: parseInt(String(stakworkProjectId)),
          },
        });
        task.stakworkProjectId = parseInt(String(stakworkProjectId));
      } else {
        console.warn("Task created without stakworkProjectId (Stakwork call failed)");
      }
    } catch (error) {
      console.error("Error updating task with stakworkProjectId:", error);
      // Non-fatal - task was still created successfully
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
