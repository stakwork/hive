import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

export const runtime = "nodejs";

export const fetchCache = "force-no-store";

interface WorkflowEditorRequest {
  taskId: string;
  message: string;
  workflowId: number;
  workflowName: string;
  workflowRefId: string;
  stepName: string;
  stepUniqueId: string;
  stepDisplayName: string;
  stepType: string;
  stepData: Record<string, unknown>;
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

    const body = (await request.json()) as WorkflowEditorRequest;
    const {
      taskId,
      message,
      workflowId,
      workflowName,
      workflowRefId,
      stepName,
      stepUniqueId,
      stepDisplayName,
      stepType,
      stepData,
    } = body;

    // Validate required fields
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    if (!workflowId) {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    // Check if workflow editor workflow ID is configured
    if (!config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID) {
      return NextResponse.json(
        { error: "Workflow editor is not configured" },
        { status: 500 }
      );
    }

    // Find the task and get its workspace with swarm details
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            slug: true,
            ownerId: true,
            swarm: {
              select: {
                swarmUrl: true,
                swarmSecretAlias: true,
                poolName: true,
                name: true,
                id: true,
              },
            },
            members: {
              where: {
                userId: userId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Restrict workflow editor to stakwork workspace only
    if (task.workspace.slug !== "stakwork") {
      return NextResponse.json(
        { error: "Workflow editor is not available for this workspace" },
        { status: 403 }
      );
    }

    // Create the chat message
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        contextTags: JSON.stringify([]),
        status: ChatStatus.SENT,
      },
    });

    // Get GitHub credentials
    const githubProfile = await getGithubUsernameAndPAT(userId, task.workspace.slug);
    const userName = githubProfile?.username || null;
    const accessToken = githubProfile?.token || null;

    // Get swarm details
    const swarm = task.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", ":8444/api") : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    // Build webhook URLs
    const appBaseUrl = getBaseUrl();
    const webhookUrl = `${appBaseUrl}/api/chat/response`;
    const workflowWebhookUrl = `${appBaseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // Build workflow editor specific vars
    const vars = {
      // Task context
      taskId,
      message,
      webhookUrl,

      // Workflow context
      workflow_id: workflowId,
      workflow_name: workflowName,
      workflow_ref_id: workflowRefId,
      workflow_step_name: stepName,
      step_unique_id: stepUniqueId,
      step_display_name: stepDisplayName,
      step_type: stepType,
      step_data: stepData,

      // Standard swarm vars
      alias: userName,
      username: userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      workspaceId: task.workspaceId,
    };

    // Build Stakwork payload
    const stakworkPayload = {
      name: "workflow_editor",
      workflow_id: parseInt(config.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    // Make Stakwork API call
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
      console.error(`Failed to call workflow editor: ${response.statusText}`);
      await db.task.update({
        where: { id: taskId },
        data: { workflowStatus: WorkflowStatus.FAILED },
      });
      return NextResponse.json(
        { error: `Stakwork call failed: ${response.statusText}` },
        { status: 500 }
      );
    }

    const result = await response.json();

    if (result.success) {
      const updateData: {
        workflowStatus: WorkflowStatus;
        workflowStartedAt: Date;
        stakworkProjectId?: number;
      } = {
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
      };

      if (result.data?.project_id) {
        updateData.stakworkProjectId = result.data.project_id;
      }

      await db.task.update({
        where: { id: taskId },
        data: updateData,
      });
    } else {
      await db.task.update({
        where: { id: taskId },
        data: { workflowStatus: WorkflowStatus.FAILED },
      });
    }

    return NextResponse.json(
      {
        success: result.success,
        message: chatMessage,
        workflow: result.data,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in workflow editor:", error);
    return NextResponse.json(
      { error: "Failed to process workflow editor request" },
      { status: 500 }
    );
  }
}
