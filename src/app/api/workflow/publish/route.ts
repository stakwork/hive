import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";

export const runtime = "nodejs";

export const fetchCache = "force-no-store";

interface PublishWorkflowRequest {
  workflowId: number;
  workflowRefId?: string;
  artifactId?: string;
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

    const body = (await request.json()) as PublishWorkflowRequest;
    const { workflowId, workflowRefId, artifactId } = body;

    if (!workflowId) {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    // Verify user has access to stakwork workspace
    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json({ error: "Access denied - not a member of stakwork workspace" }, { status: 403 });
    }

    // Call Stakwork API to publish the workflow
    const publishUrl = `${config.STAKWORK_BASE_URL}/workflows/${workflowId}/publish`;

    console.log("Publishing workflow to:", publishUrl);

    const response = await fetch(publishUrl, {
      method: "POST",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to publish workflow ${workflowId}:`, errorText);
      return NextResponse.json(
        { error: "Failed to publish workflow", details: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: result.error?.message || "Failed to publish workflow" }, { status: 400 });
    }

    const workflowVersionId = result.data?.workflow_version_id;

    // Update the artifact to mark it as published
    if (artifactId) {
      try {
        const artifact = await db.artifact.findUnique({
          where: { id: artifactId },
        });

        if (artifact) {
          const currentContent = (artifact.content as Record<string, unknown>) || {};
          await db.artifact.update({
            where: { id: artifactId },
            data: {
              content: {
                ...currentContent,
                published: true,
                publishedAt: new Date().toISOString(),
                workflowVersionId: result.data?.workflow_version_id,
              },
            },
          });
        }
      } catch (updateError) {
        console.error("Error updating artifact:", updateError);
        // Don't fail the request if artifact update fails
      }
    }

    // Fetch updated workflow and create new artifact message
    if (artifactId) {
      try {
        // Get the artifact with its message and task
        const artifactWithMessage = await db.artifact.findUnique({
          where: { id: artifactId },
          include: {
            message: {
              include: {
                task: true,
              },
            },
          },
        });

        if (artifactWithMessage?.message?.task?.id && workflowVersionId) {
          const task = artifactWithMessage.message.task;
          const taskId = task.id;
          const projectId = task.stakworkProjectId;

          // Fetch the updated workflow definition from Stakwork
          const workflowUrl = `${config.STAKWORK_BASE_URL}/workflows/${workflowId}/`;
          console.log("Fetching updated workflow from:", workflowUrl);

          const workflowResponse = await fetch(workflowUrl, {
            method: "GET",
            headers: {
              Authorization: `Token token=${config.STAKWORK_API_KEY}`,
              "Content-Type": "application/json",
            },
          });

          if (workflowResponse.ok) {
            const workflowResult = await workflowResponse.json();
            console.log("Fetched workflow response keys:", Object.keys(workflowResult));
            console.log(
              "Fetched workflow data keys:",
              workflowResult.data ? Object.keys(workflowResult.data) : "no data",
            );
            console.log(
              "Fetched workflow.workflow keys:",
              workflowResult.data?.workflow ? Object.keys(workflowResult.data.workflow) : "no workflow",
            );

            // The workflow_json should be in data.workflow.workflow_json or data.spec
            const updatedWorkflowJson =
              workflowResult.data?.workflow?.workflow_json ||
              workflowResult.data?.spec ||
              workflowResult.data?.workflow_json ||
              workflowResult.workflow_json;

            console.log("Updated workflow JSON found:", !!updatedWorkflowJson, typeof updatedWorkflowJson);

            if (updatedWorkflowJson) {
              // Get workflowName from the PUBLISH_WORKFLOW artifact content
              const publishContent = (artifactWithMessage.content || {}) as {
                workflowName?: string;
                workflowRefId?: string;
              };

              // Create a new message with the updated WORKFLOW artifact
              // Include both workflowJson (for Editor tab) and projectId (for Stakwork tab)
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
                          workflowJson: updatedWorkflowJson as string,
                          workflowId: workflowId,
                          workflowName: publishContent.workflowName || `Workflow ${workflowId}`,
                          workflowRefId: workflowRefId || publishContent.workflowRefId || "",
                          // Include projectId for Stakwork tab to show the project execution
                          ...(projectId && { projectId: projectId.toString() }),
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

              console.log(`Published workflow ${workflowId} and created new artifact message for task ${taskId}`);
            }
          } else {
            console.error("Failed to fetch updated workflow from Stakwork:", await workflowResponse.text());
          }
        }
      } catch (updateError) {
        console.error("Error creating updated workflow artifact:", updateError);
        // Don't fail the request if this fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          workflowId,
          workflowRefId,
          published: true,
          workflowVersionId,
          message: "Workflow published successfully",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error publishing workflow:", error);
    return NextResponse.json({ error: "Failed to publish workflow" }, { status: 500 });
  }
}
