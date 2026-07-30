import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { isSafeId } from "@/lib/utils/ids";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";

export const runtime = "nodejs";

export const fetchCache = "force-no-store";

interface PublishWorkflowRequest {
  workflowId: number;
  workflowRefId?: string;
  artifactId?: string;
}

/** Extract the workflow_json string from a Stakwork workflow GET response. */
function extractWorkflowJson(
  result: Record<string, unknown>,
): string | undefined {
  const data = result.data as Record<string, unknown> | undefined;
  const workflow = data?.workflow as Record<string, unknown> | undefined;
  return (
    (workflow?.workflow_json as string | undefined) ||
    (data?.spec as string | undefined) ||
    (data?.workflow_json as string | undefined) ||
    (result.workflow_json as string | undefined)
  );
}

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = requireAuth(getMiddlewareContext(request));
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const body = (await request.json()) as PublishWorkflowRequest;
    const { workflowId, workflowRefId, artifactId } = body;

    if (!workflowId) {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    if (!isSafeId(String(workflowId))) {
      return NextResponse.json({ error: "Invalid workflowId format" }, { status: 400 });
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

    // ── Hoist authorization + context resolution BEFORE the publish POST ──────
    // Resolve the artifact (and its workspace) ahead of time so that we avoid an
    // IDOR where a caller could trigger artifact writes for an artifact in a
    // workspace they don't own.
    let resolvedArtifactWithMessage: Awaited<ReturnType<typeof db.artifact.findUnique>> & {
      message?: {
        task?: {
          id: string;
          stakworkProjectId: number | null;
          workspace?: { id: string } | null;
        } | null;
      } | null;
    } | null = null;
    let callerHasAccess = false;

    if (artifactId) {
      try {
        resolvedArtifactWithMessage = await db.artifact.findUnique({
          where: { id: artifactId },
          include: {
            message: {
              include: {
                task: {
                  include: { workspace: true },
                },
              },
            },
          },
        });

        const artifactWorkspaceId =
          resolvedArtifactWithMessage?.message?.task?.workspace?.id;
        callerHasAccess =
          devMode ||
          !!(stakworkWorkspace && artifactWorkspaceId === stakworkWorkspace.id);
      } catch (err) {
        console.error("[publish] Error resolving artifact for authorization:", err);
      }
    }

    // ── Call Stakwork API to publish the workflow ─────────────────────────────
    const publishUrl = `${config.STAKWORK_BASE_URL}/workflows/${encodeURIComponent(String(workflowId))}/publish`;

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

    // ── Update the PUBLISH_WORKFLOW artifact (published / publishedAt / workflowVersionId) ──
    if (artifactId) {
      try {
        if (!callerHasAccess) {
          // Artifact is not in the caller's workspace — skip all writes silently
          // (treat as not found to avoid leaking existence of other artifacts)
        } else if (resolvedArtifactWithMessage) {
          // Update the artifact to mark it as published
          const currentContent =
            (resolvedArtifactWithMessage.content as Record<string, unknown>) || {};
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

    // ── Fetch just-published workflow and create new WORKFLOW artifact message ─
    if (artifactId) {
      try {
        if (!callerHasAccess) {
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
        }

        const taskId = resolvedArtifactWithMessage?.message?.task?.id;
        const projectId = resolvedArtifactWithMessage?.message?.task?.stakworkProjectId;

        if (taskId && workflowVersionId) {
          // Fetch the just-published workflow definition from Stakwork
          const workflowUrl = `${config.STAKWORK_BASE_URL}/workflows/${encodeURIComponent(String(workflowId))}/`;
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
            const updatedWorkflowJson = extractWorkflowJson(workflowResult);

            console.log(
              "[publish] Fetched just-published workflow JSON:",
              !!updatedWorkflowJson,
              typeof updatedWorkflowJson,
            );

            if (updatedWorkflowJson) {
              // Get workflowName from the PUBLISH_WORKFLOW artifact content
              const publishContent = (resolvedArtifactWithMessage?.content || {}) as {
                workflowName?: string;
                workflowRefId?: string;
              };

              console.log(
                `[publish] Stored workflow snapshot: workflowId=${workflowId}, workflowVersionId=${workflowVersionId}, versionWorkflowJson=ok`,
              );

              // Create a new message with the updated WORKFLOW artifact.
              // versionWorkflowJson: landing-time version-pinned snapshot (new model)
              // publishedWorkflowJson: durable snapshot for legacy diff / Editor view
              // workflowJson: same as publishedWorkflowJson (drives the editor)
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
                          publishedWorkflowJson: updatedWorkflowJson as string,
                          versionWorkflowJson: updatedWorkflowJson as string,
                          workflowVersionId: workflowVersionId,
                          workflowId: workflowId,
                          workflowName:
                            publishContent.workflowName || `Workflow ${workflowId}`,
                          workflowRefId:
                            workflowRefId || publishContent.workflowRefId || "",
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

              console.log(
                `Published workflow ${workflowId} and created new artifact message for task ${taskId}`,
              );
            }
          } else {
            console.error(
              "[publish] Failed to fetch updated workflow from Stakwork:",
              await workflowResponse.text(),
            );
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
