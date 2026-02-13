import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, WorkflowStatus, ArtifactType } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

/**
 * POST /api/project-debugger
 *
 * Handles Project Debugger mode requests.
 * Similar to workflow-editor, but validates and debugs Stakwork projects.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { taskId, message, projectId, webhook } = body;

    // Validate required fields
    if (!taskId || !message || !projectId) {
      return NextResponse.json({ error: "Missing required fields: taskId, message, projectId" }, { status: 400 });
    }

    // Get the task and ensure the user is authorized
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        workspace: {
          include: {
            members: {
              where: {
                userId: session.user.id,
              },
            },
            owner: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is owner or member
    const isOwner = task.workspace.owner.id === session.user.id;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Unauthorized: Not a workspace member" }, { status: 403 });
    }

    // In production, restrict to stakwork workspace only
    if (process.env.NODE_ENV === "production" && task.workspace.slug !== "stakwork") {
      return NextResponse.json({ error: "Project debugger is only available in stakwork workspace" }, { status: 403 });
    }

    // Fetch project data from Stakwork API
    const projectUrl = `${config.STAKWORK_BASE_URL}/projects/${projectId}`;
    const projectResponse = await fetch(projectUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!projectResponse.ok) {
      if (projectResponse.status === 404) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      console.error(`Failed to fetch project from Stakwork: ${projectResponse.statusText}`);
      return NextResponse.json({ error: `Failed to fetch project: ${projectResponse.statusText}` }, { status: 500 });
    }

    const projectResult = await projectResponse.json();

    if (!projectResult.success || !projectResult.data?.project) {
      return NextResponse.json({ error: "Invalid project data" }, { status: 404 });
    }

    const projectData = projectResult.data.project;

    // Create the initial chat message
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        contextTags: JSON.stringify([]),
      },
    });

    // Get workspace swarm configuration for credentials
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: task.workspaceId },
    });

    // Get GitHub credentials for the user
    const githubProfile = await getGithubUsernameAndPAT(session.user.id, task.workspace.slug);

    // Build workflow variables object with project data
    const workflowVars = {
      // Project data
      project_id: projectData.id,
      name: projectData.name,
      workflow_state: projectData.workflow_state,
      workflow_id: projectData.workflow_id,
      created_at: projectData.created_at,
      updated_at: projectData.updated_at,
      current_transition: projectData.current_transition,
      project_configs: projectData.project_configs,

      // Task context
      taskId,
      message,
      webhookUrl: `${process.env.NEXTAUTH_URL}/api/stakwork/webhook?task_id=${taskId}`,

      // User credentials
      username: githubProfile?.username || "",
      accessToken: githubProfile?.token || "",

      // Swarm configuration
      swarmUrl: swarm?.swarmUrl || "",
      swarmSecretAlias: swarm?.swarmSecretAlias || "",
      poolName: swarm?.poolName || "",

      // Workspace context
      workspaceId: task.workspaceId,
    };

    // Build Stakwork payload
    const stakworkPayload = {
      name: `project-debugger-${projectData.id}-${Date.now()}`,
      workflow_params: {
        set_var: {
          attributes: {
            vars: workflowVars,
          },
        },
      },
      workflow_id: config.STAKWORK_WORKFLOW_PROJECT_DEBUGGER_ID,
    };

    // If webhook is provided, use it to continue existing workflow; otherwise start new project
    const stakworkURL = webhook || `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to call project debugger workflow: ${response.statusText}`);
      await db.task.update({
        where: { id: taskId },
        data: { workflowStatus: WorkflowStatus.FAILED },
      });
      return NextResponse.json(
        { error: `Stakwork call failed: ${response.statusText}` },
        { status: 500 },
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

      // Create a new WORKFLOW artifact with the projectId and project metadata
      if (result.data?.project_id) {
        try {
          const newMessage = await db.chatMessage.create({
            data: {
              taskId,
              message: "",
              role: ChatRole.ASSISTANT,
              status: ChatStatus.SENT,
              contextTags: JSON.stringify([]),
              artifacts: {
                create: [
                  {
                    type: ArtifactType.WORKFLOW,
                    content: {
                      projectId: result.data.project_id.toString(),
                      workflowId: projectData.workflow_id,
                      projectInfo: projectData,
                      debuggerProjectId: projectId,
                    },
                  },
                ],
              },
            },
            include: {
              artifacts: true,
            },
          });

          // Trigger Pusher to notify the frontend
          const channelName = getTaskChannelName(taskId);
          await pusherServer.trigger(channelName, PUSHER_EVENTS.NEW_MESSAGE, newMessage.id);
        } catch (artifactError) {
          console.error("Error creating workflow artifact:", artifactError);
          // Don't fail the request if artifact creation fails
        }
      }
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
        project: projectData,
        webhook: result.data?.webhook_url,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error in project debugger:", error);
    return NextResponse.json({ error: "Failed to process project debugger request" }, { status: 500 });
  }
}
