import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus, Prisma } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { releaseTaskPod } from "@/lib/pods/utils";
import type { PullRequestContent } from "@/lib/chat";

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
        console.log("[GithubWebhook] PR merged - checking for pod release", {
          delivery,
          workspaceId: repository.workspaceId,
          prUrl,
        });

        try {
          // Query database for tasks with matching PR artifact
          const tasks = await db.$queryRaw<
            Array<{
              task_id: string;
              pod_id: string | null;
              workspace_id: string;
            }>
          >(
            Prisma.sql`
              SELECT t.id as task_id, t.pod_id, t.workspace_id
              FROM artifacts a
              JOIN chat_messages m ON a.message_id = m.id
              JOIN tasks t ON m.task_id = t.id
              WHERE a.type = 'PULL_REQUEST'
                AND a.content->>'url' = ${prUrl}
                AND t.deleted = false
                AND t.archived = false
                AND t.pod_id IS NOT NULL
            `,
          );

          if (tasks.length === 0) {
            console.log("[GithubWebhook] PR merged - no tasks with pods found", {
              delivery,
              prUrl,
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }

          if (tasks.length > 1) {
            console.warn("[GithubWebhook] PR merged - multiple tasks with pods found, manual resolution needed", {
              delivery,
              prUrl,
              taskIds: tasks.map((t) => t.task_id),
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }

          // Exactly one task found - attempt pod release
          const task = tasks[0];
          console.log("[GithubWebhook] PR merged - releasing pod for task", {
            delivery,
            prUrl,
            taskId: task.task_id,
            podId: task.pod_id,
          });

          const result = await releaseTaskPod({
            taskId: task.task_id,
            podId: task.pod_id!,
            workspaceId: task.workspace_id,
            verifyOwnership: true,
            clearTaskFields: true,
            newWorkflowStatus: null, // Don't change workflow status - PR merged but task may not be complete
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
            console.error("[GithubWebhook] PR merged - pod release: failed", {
              delivery,
              prUrl,
              taskId: task.task_id,
              error: result.error,
            });
            return NextResponse.json({ success: true }, { status: 202 });
          }
        } catch (error) {
          console.error("[GithubWebhook] PR merged - pod release error", {
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
