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
    // Resolve the artifact (and its workspace) ahead of time so that:
    //  1. The pre-publish baseline fetch is only issued for authorised callers.
    //  2. We avoid an IDOR where a caller could trigger an external fetch for an
    //     artifact in a workspace they don't own.
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

    // ── Capture pre-publish baseline (must happen BEFORE the publish POST) ───
    // Only when artifactId is present and caller has verified access.
    // baseline === undefined  → fetch not attempted (no artifactId / no access)
    // baseline === null       → GET succeeded, no currently-published version (brand-new)
    // baseline === string     → pre-publish workflow_json string
    let baseline: string | null | undefined = undefined;

    if (artifactId && callerHasAccess) {
      const baselineUrl = `${config.STAKWORK_BASE_URL}/workflows/${encodeURIComponent(String(workflowId))}/`;
      try {
        const baselineResponse = await fetch(baselineUrl, {
          method: "GET",
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        if (baselineResponse.ok) {
          const baselineResult = await baselineResponse.json();
          const extracted = extractWorkflowJson(baselineResult);
          // null = brand-new (GET succeeded but no spec returned)
          baseline = extracted ?? null;
          console.log(
            `[publish] Pre-publish baseline captured: workflowId=${workflowId}, baselinePresent=${baseline !== null}, brandNew=${baseline === null}`,
          );
        } else {
          // Non-ok → fetch failed; do NOT treat as brand-new
          const errText = await baselineResponse.text().catch(() => "(unreadable)");
          console.error(
            `[publish] Baseline fetch FAILED (non-ok): workflowId=${workflowId}, status=${baselineResponse.status}, body=${errText}. ` +
              `Baseline will NOT be stored — this is a fetch error, not a brand-new workflow.`,
          );
          // baseline remains undefined → skip storing baseline on new artifact
        }
      } catch (err) {
        // Network / thrown error → also NOT brand-new
        console.error(
          `[publish] Baseline fetch FAILED (thrown): workflowId=${workflowId}, error=${String(err)}. ` +
            `Baseline will NOT be stored — this is a fetch error, not a brand-new workflow.`,
        );
        // baseline remains undefined → skip storing baseline on new artifact
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
            console.log("Fetched workflow response keys:", Object.keys(workflowResult));
            console.log(
              "Fetched workflow data keys:",
              workflowResult.data ? Object.keys(workflowResult.data) : "no data",
            );
            console.log(
              "Fetched workflow.workflow keys:",
              workflowResult.data?.workflow
                ? Object.keys(workflowResult.data.workflow)
                : "no workflow",
            );

            const updatedWorkflowJson = extractWorkflowJson(workflowResult);

            console.log(
              "Updated workflow JSON found:",
              !!updatedWorkflowJson,
              typeof updatedWorkflowJson,
            );

            if (updatedWorkflowJson) {
              // Get workflowName from the PUBLISH_WORKFLOW artifact content
              const publishContent = (resolvedArtifactWithMessage?.content || {}) as {
                workflowName?: string;
                workflowRefId?: string;
              };

              // Determine originalWorkflowJson to store on the new WORKFLOW artifact.
              // baseline === undefined  → fetch error; omit the field so the panel shows "No changes"
              // baseline === null       → genuinely brand-new; store null (all-green path)
              // baseline === string     → real pre-publish spec; store it (real diff path)
              const originalWorkflowJsonValue: string | null | undefined =
                baseline === undefined ? undefined : baseline;

              // Log the boundary outcome
              const baselinePresent = typeof baseline === "string";
              const brandNew = baseline === null;
              const fetchAttempted = baseline !== undefined;
              console.log(
                `[publish] Stored workflow snapshot: workflowId=${workflowId}, workflowVersionId=${workflowVersionId}, ` +
                  `fetchAttempted=${fetchAttempted}, baselinePresent=${baselinePresent}, brandNew=${brandNew}`,
              );

              // Create a new message with the updated WORKFLOW artifact.
              // originalWorkflowJson: pre-publish baseline (null=brand-new, undefined=not stored)
              // publishedWorkflowJson: durable snapshot of the just-published workflow JSON
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
                          // Only include originalWorkflowJson when we have a meaningful value.
                          // undefined → omit key entirely (fetch error path)
                          // null      → brand-new (no prior published version)
                          // string    → real pre-publish baseline
                          ...(originalWorkflowJsonValue !== undefined && {
                            originalWorkflowJson: originalWorkflowJsonValue,
                          }),
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
              "Failed to fetch updated workflow from Stakwork:",
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
