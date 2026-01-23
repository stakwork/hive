import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus, Prisma, TaskStatus, WorkflowStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { releaseTaskPod } from "@/lib/pods/utils";
import type { PullRequestContent } from "@/lib/chat";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");

    console.log("[GithubWebhook] Received", {
      event,
      delivery,
      workspaceId,
      hasSignature: !!signature,
    });

    if (!signature || !event) {
      console.error("[GithubWebhook] Missing signature or event", { hasSignature: !!signature, event });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const rawBody = await request.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error(`Error parsing payload: ${error}`);
      console.error(rawBody);
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const repoHtmlUrl: string | undefined = payload?.repository?.html_url;
    const fullName: string | undefined = payload?.repository?.full_name;
    const candidateUrl = repoHtmlUrl || (fullName ? `https://github.com/${fullName}` : undefined);
    if (!candidateUrl) {
      console.error("[GithubWebhook] Missing candidate url", { delivery });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const webhookId = request.headers.get("x-github-hook-id");
    if (!webhookId) {
      console.error("[GithubWebhook] Missing webhook ID", { delivery, candidateUrl });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Find repository by webhookId AND workspaceId for stronger isolation
    const repository = await db.repository.findFirst({
      where: {
        githubWebhookId: webhookId,
        workspaceId: workspaceId,
        workspace: {
          deleted: false,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        repositoryUrl: true,
        branch: true,
        workspaceId: true,
        githubWebhookSecret: true,
        workspace: {
          select: {
            swarm: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!repository || !repository.githubWebhookSecret) {
      console.error("[GithubWebhook] Repository not found or missing secret", {
        delivery,
        webhookId,
        workspaceId,
        candidateUrl,
      });
      return NextResponse.json({ success: false }, { status: 404 });
    }

    console.log("[GithubWebhook] Repository found", {
      delivery,
      repositoryUrl: repository.repositoryUrl,
      workspaceId: repository.workspaceId,
      branch: repository.branch,
    });

    const enc = EncryptionService.getInstance();
    const secret = enc.decryptField("githubWebhookSecret", repository.githubWebhookSecret);

    const expectedDigest = computeHmacSha256Hex(secret, rawBody);
    const expected = `sha256=${expectedDigest}`;

    if (!timingSafeEqual(expected, signature)) {
      console.error("[GithubWebhook] Signature verification failed", {
        delivery,
        repositoryUrl: repository.repositoryUrl,
        workspaceId: repository.workspaceId,
      });
      return NextResponse.json({ success: false }, { status: 401 });
    }

    console.log("[GithubWebhook] Signature verified", {
      delivery,
      workspaceId: repository.workspaceId,
    });

    const repoDefaultBranch: string | undefined = payload?.repository?.default_branch;
    const allowedBranches = new Set<string>(
      [repository.branch, repoDefaultBranch, "main", "master"].filter(Boolean) as string[],
    );

    // Fetch GitHub credentials early for both push and PR events
    const workspace = await db.workspace.findUnique({
      where: { id: repository.workspaceId },
      select: { ownerId: true, slug: true },
    });

    let githubPat: string | undefined;
    if (workspace?.ownerId) {
      const creds = await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug);
      if (creds) {
        githubPat = creds.token;
      }
    }

    console.log("[GithubWebhook] GitHub credentials", {
      delivery,
      workspaceId: repository.workspaceId,
      hasCredentials: !!githubPat,
    });

    if (event === "push") {
      const ref: string | undefined = payload?.ref;
      if (!ref) {
        console.error("[GithubWebhook] Missing ref in push event", {
          delivery,
          workspaceId: repository.workspaceId,
        });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      const pushedBranch = ref.split("/").pop();
      if (!pushedBranch) {
        console.error("[GithubWebhook] Missing pushed branch", {
          delivery,
          workspaceId: repository.workspaceId,
          ref,
        });
        return NextResponse.json({ success: false }, { status: 400 });
      }
      if (!allowedBranches.has(pushedBranch)) {
        console.log("[GithubWebhook] Branch not in allowed list, skipping", {
          delivery,
          workspaceId: repository.workspaceId,
          pushedBranch,
          allowedBranches: Array.from(allowedBranches),
        });
        return NextResponse.json({ success: true }, { status: 202 });
      }
      console.log("[GithubWebhook] Branch validated", {
        delivery,
        workspaceId: repository.workspaceId,
        pushedBranch,
      });
    } else if (event === "pull_request") {
      const action = payload?.action;
      const merged = payload?.pull_request?.merged;
      const prUrl = payload?.pull_request?.html_url;

      // Check if PR was merged (closed + merged=true)
      if (action === "closed" && merged === true && prUrl) {
        console.log("[GithubWebhook] PR merged - processing task updates", {
          delivery,
          workspaceId: repository.workspaceId,
          prUrl,
        });

        try {
          // Query database for ALL tasks with matching PR artifact (not just those with pods)
          const tasks = await db.$queryRaw<
            Array<{
              task_id: string;
              pod_id: string | null;
              workspace_id: string;
              status: TaskStatus;
              feature_id: string | null;
              artifact_id: string;
              workflow_status: WorkflowStatus | null;
            }>
          >(
            Prisma.sql`
              SELECT t.id as task_id, t.pod_id, t.workspace_id, t.status, t.feature_id, 
                     a.id as artifact_id, t.workflow_status
              FROM artifacts a
              JOIN chat_messages m ON a.message_id = m.id
              JOIN tasks t ON m.task_id = t.id
              WHERE a.type = 'PULL_REQUEST'
                AND a.content->>'url' = ${prUrl}
                AND t.deleted = false
                AND t.archived = false
            `,
          );

          if (tasks.length === 0) {
            console.log("[GithubWebhook] PR merged - no tasks found", {
              delivery,
              prUrl,
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }

          if (tasks.length > 1) {
            console.warn("[GithubWebhook] PR merged - multiple tasks found, manual resolution needed", {
              delivery,
              prUrl,
              taskIds: tasks.map((t) => t.task_id),
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }

          // Exactly one task found - update task, artifact, broadcast, and release pod if applicable
          const task = tasks[0];
          console.log("[GithubWebhook] PR merged - updating task status and artifact", {
            delivery,
            prUrl,
            taskId: task.task_id,
            currentStatus: task.status,
            hasPod: !!task.pod_id,
            hasFeature: !!task.feature_id,
          });

          // Update task status to DONE
          await db.task.update({
            where: { id: task.task_id },
            data: { status: TaskStatus.DONE },
          });

          console.log("[GithubWebhook] PR merged - task status updated to DONE", {
            delivery,
            taskId: task.task_id,
          });

          // Update PR artifact content status to "DONE"
          try {
            const artifact = await db.artifact.findUnique({
              where: { id: task.artifact_id },
              select: { content: true },
            });

            if (artifact?.content && typeof artifact.content === 'object') {
              const updatedContent = {
                ...artifact.content,
                status: "DONE",
              };

              await db.artifact.update({
                where: { id: task.artifact_id },
                data: { content: updatedContent as Prisma.InputJsonValue },
              });

              console.log("[GithubWebhook] PR merged - artifact status updated to DONE", {
                delivery,
                artifactId: task.artifact_id,
              });
            }
          } catch (artifactError) {
            console.error("[GithubWebhook] PR merged - failed to update artifact status", {
              delivery,
              artifactId: task.artifact_id,
              error: artifactError,
            });
            // Continue processing - don't fail webhook on artifact update error
          }

          // Broadcast Pusher event for real-time UI updates
          if (workspace?.slug) {
            try {
              const channelName = getWorkspaceChannelName(workspace.slug);
              await pusherServer.trigger(channelName, PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, {
                taskId: task.task_id,
                status: TaskStatus.DONE,
                workflowStatus: task.workflow_status,
                archived: false,
                timestamp: new Date(),
              });

              console.log("[GithubWebhook] PR merged - Pusher event broadcasted", {
                delivery,
                taskId: task.task_id,
                channel: channelName,
              });
            } catch (pusherError) {
              console.error("[GithubWebhook] PR merged - Pusher broadcast failed (non-blocking)", {
                delivery,
                taskId: task.task_id,
                error: pusherError,
              });
              // Continue processing - don't fail webhook on Pusher error
            }
          }

          // Trigger feature status cascade if task belongs to a feature
          if (task.feature_id) {
            try {
              await updateFeatureStatusFromTasks(task.feature_id);
              console.log("[GithubWebhook] PR merged - feature status cascade triggered", {
                delivery,
                featureId: task.feature_id,
              });
            } catch (featureError) {
              console.error("[GithubWebhook] PR merged - feature status cascade failed (non-blocking)", {
                delivery,
                featureId: task.feature_id,
                error: featureError,
              });
              // Continue processing - don't fail webhook on feature sync error
            }
          }

          // Release pod if task has one assigned
          if (task.pod_id) {
            console.log("[GithubWebhook] PR merged - releasing pod for task", {
              delivery,
              prUrl,
              taskId: task.task_id,
              podId: task.pod_id,
            });

            const result = await releaseTaskPod({
              taskId: task.task_id,
              podId: task.pod_id,
              workspaceId: task.workspace_id,
              verifyOwnership: true,
              clearTaskFields: true,
              newWorkflowStatus: null, // Don't change workflow status - we already set task to DONE
            });

            if (result.success) {
              if (result.reassigned) {
                console.log("[GithubWebhook] PR merged - pod release: pod was reassigned", {
                  delivery,
                  prUrl,
                  taskId: task.task_id,
                  podId: task.pod_id,
                });
              } else if (result.podDropped) {
                console.log("[GithubWebhook] PR merged - pod release: success", {
                  delivery,
                  prUrl,
                  taskId: task.task_id,
                  podId: task.pod_id,
                });
              } else {
                console.log("[GithubWebhook] PR merged - pod release: partial success (task cleared)", {
                  delivery,
                  prUrl,
                  taskId: task.task_id,
                  taskCleared: result.taskCleared,
                });
              }
              return NextResponse.json({ success: true }, { status: result.podDropped ? 200 : 202 });
            } else {
              console.error("[GithubWebhook] PR merged - pod release: failed (non-blocking)", {
                delivery,
                prUrl,
                taskId: task.task_id,
                error: result.error,
              });
              // Still return success - task status was updated
              return NextResponse.json({ success: true }, { status: 202 });
            }
          } else {
            // No pod to release - task status and artifact updated successfully
            console.log("[GithubWebhook] PR merged - task updated successfully (no pod)", {
              delivery,
              taskId: task.task_id,
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }
        } catch (error) {
          console.error("[GithubWebhook] PR merged - error processing task updates", {
            delivery,
            prUrl,
            error,
          });
          return NextResponse.json({ success: true }, { status: 202 });
        }
      }

      console.log("[GithubWebhook] PR action not handled, skipping", {
        delivery,
        workspaceId: repository.workspaceId,
        action,
        merged,
      });

      // For pull_request events, we don't trigger sync, so return here
      return NextResponse.json({ success: true }, { status: 202 });
    } else {
      console.log("[GithubWebhook] Event type not handled, skipping", {
        delivery,
        event,
        workspaceId: repository.workspaceId,
      });
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: repository.workspaceId },
      select: {
        id: true,
        name: true,
        swarmUrl: true,
        swarmApiKey: true,
        autoLearnEnabled: true,
      },
    });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      console.error("[GithubWebhook] Swarm not found or misconfigured", {
        delivery,
        workspaceId: repository.workspaceId,
        hasSwarm: !!swarm,
        hasName: !!swarm?.name,
        hasApiKey: !!swarm?.swarmApiKey,
      });
      return NextResponse.json({ success: false }, { status: 400 });
    }

    console.log("[GithubWebhook] Swarm found", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmName: swarm.name,
    });

    // Get username from credentials for async sync
    const username = workspace?.ownerId
      ? (await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug))?.username
      : undefined;

    // Decrypt the swarm API key
    let decryptedSwarmApiKey: string;
    try {
      const parsed = typeof swarm.swarmApiKey === "string" ? JSON.parse(swarm.swarmApiKey) : swarm.swarmApiKey;
      decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
    } catch (error) {
      console.error("Failed to decrypt swarmApiKey:", error);
      decryptedSwarmApiKey = swarm.swarmApiKey as string;
    }

    const swarmHost = swarm.swarmUrl ? new URL(swarm.swarmUrl).host : `${swarm.name}.sphinx.chat`;
    try {
      await db.repository.update({
        where: { id: repository.id },
        data: { status: RepositoryStatus.PENDING },
      });
      console.log("[GithubWebhook] Repository status → PENDING", {
        delivery,
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
      });
    } catch (err) {
      console.error("[GithubWebhook] Failed to set repository to PENDING", {
        delivery,
        workspaceId: repository.workspaceId,
        error: err,
      });
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);

    console.log("[GithubWebhook] Triggering async sync", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      swarmHost,
      repositoryUrl: repository.repositoryUrl,
      callbackUrl,
      hasGithubAuth: !!(username && githubPat),
    });

    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarmHost,
      decryptedSwarmApiKey,
      repository.repositoryUrl,
      username && githubPat ? { username, pat: githubPat } : undefined,
      callbackUrl,
    );

    console.log("[GithubWebhook] Async sync response", {
      delivery,
      workspaceId: repository.workspaceId,
      swarmId: swarm.id,
      ok: apiResult.ok,
      status: apiResult.status,
      hasRequestId: !!apiResult.data?.request_id,
    });

    // Trigger auto-learn if enabled (for push events to allowed branches)
    try {
      triggerAutoLearnIfEnabled({
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
        githubPat,
        delivery,
        swarm: {
          autoLearnEnabled: swarm.autoLearnEnabled,
          swarmUrl: swarm.swarmUrl,
        },
        decryptedSwarmApiKey,
      });
    } catch (error) {
      console.error("[GithubWebhook] Auto-learn trigger failed, continuing", {
        delivery,
        workspaceId: repository.workspaceId,
        error,
      });
    }

    try {
      const reqId = apiResult.data?.request_id;
      if (reqId) {
        await db.swarm.update({
          where: { id: swarm.id },
          data: { ingestRefId: reqId },
        });
        console.log("[GithubWebhook] Saved ingest reference", {
          delivery,
          requestId: reqId,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        });
      } else {
        console.error("[GithubWebhook] No request_id in response", {
          delivery,
          workspaceId: repository.workspaceId,
          swarmId: swarm.id,
        });
      }
    } catch (e) {
      console.error("[GithubWebhook] Failed to persist ingestRefId", {
        delivery,
        workspaceId: repository.workspaceId,
        swarmId: swarm.id,
        error: e,
      });
    }

    return NextResponse.json({ success: apiResult.ok, delivery }, { status: 202 });
  } catch (error) {
    console.error("[GithubWebhook] Unhandled error", { error });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

interface AutoLearnParams {
  workspaceId: string;
  repositoryUrl: string;
  githubPat: string | undefined;
  delivery: string | null;
  swarm: {
    autoLearnEnabled: boolean | null;
    swarmUrl: string | null;
  };
  decryptedSwarmApiKey: string;
}

/**
 * Triggers the gitree/process endpoint if autoLearnEnabled is true on the workspace swarm.
 * This is called on push events to allowed branches to automatically update the knowledge base.
 */
function triggerAutoLearnIfEnabled({
  workspaceId,
  repositoryUrl,
  githubPat,
  delivery,
  swarm,
  decryptedSwarmApiKey,
}: AutoLearnParams) {
  if (!swarm.autoLearnEnabled) {
    console.log("[GithubWebhook] Auto-learn disabled, skipping", {
      delivery,
      workspaceId,
      autoLearnEnabled: swarm.autoLearnEnabled ?? false,
    });
    return;
  }

  if (!swarm.swarmUrl) {
    console.error("[GithubWebhook] Auto-learn enabled but swarm URL not configured", {
      delivery,
      workspaceId,
    });
    return;
  }

  if (!githubPat) {
    console.error("[GithubWebhook] Auto-learn enabled but no GitHub PAT available", {
      delivery,
      workspaceId,
    });
    return;
  }

  // Parse repository URL to get owner/repo
  let owner: string, repo: string;
  try {
    const parsed = parseOwnerRepo(repositoryUrl);
    owner = parsed.owner;
    repo = parsed.repo;
  } catch (error) {
    console.error("[GithubWebhook] Failed to parse repository URL for auto-learn", {
      delivery,
      workspaceId,
      repositoryUrl,
      error,
    });
    return;
  }

  // Build swarm base URL
  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  // Trigger gitree/process (fire and forget)
  const gitreeUrl = `${baseSwarmUrl}/gitree/process?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&token=${encodeURIComponent(githubPat)}&summarize=true&link=true`;

  console.log("[GithubWebhook] Triggering auto-learn gitree/process", {
    delivery,
    workspaceId,
    owner,
    repo,
  });

  fetch(gitreeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": decryptedSwarmApiKey,
    },
  })
    .then((response) => {
      if (!response.ok) {
        console.error("[GithubWebhook] Auto-learn gitree/process failed", {
          delivery,
          workspaceId,
          status: response.status,
        });
      } else {
        console.log("[GithubWebhook] Auto-learn gitree/process initiated successfully", {
          delivery,
          workspaceId,
        });
      }
    })
    .catch((error) => {
      console.error("[GithubWebhook] Auto-learn gitree/process request failed", {
        delivery,
        workspaceId,
        error,
      });
    });
}
