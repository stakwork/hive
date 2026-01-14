import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { storePullRequest, type PullRequestPayload } from "@/lib/github/storePullRequest";
import { parseOwnerRepo } from "@/lib/ai/utils";

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

      if (action === "closed" && merged === true) {
        const baseBranch = payload?.pull_request?.base?.ref;
        const isDefaultBranch = baseBranch === repository.branch;

        console.log("[GithubWebhook] Processing merged PR", {
          delivery,
          workspaceId: repository.workspaceId,
          prNumber: payload.number,
          baseBranch,
          repositoryBranch: repository.branch,
          isDefaultBranch,
        });

        // Store PR data without failing the webhook if this fails
        try {
          await storePullRequest(payload as PullRequestPayload, repository.id, repository.workspaceId, githubPat);
        } catch (error) {
          console.error("[GithubWebhook] Failed to store PR, continuing", {
            delivery,
            workspaceId: repository.workspaceId,
            prNumber: payload.number,
            error,
          });
        }

        // Trigger auto-learn if enabled and PR was merged to the default branch
        if (isDefaultBranch) {
          try {
            await triggerAutoLearnIfEnabled(repository.workspaceId, repository.repositoryUrl, githubPat, delivery);
          } catch (error) {
            console.error("[GithubWebhook] Auto-learn trigger failed, continuing", {
              delivery,
              workspaceId: repository.workspaceId,
              error,
            });
          }
        }
      } else {
        console.log("[GithubWebhook] PR action not handled, skipping", {
          delivery,
          workspaceId: repository.workspaceId,
          action,
          merged,
        });
      }

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

/**
 * Triggers the gitree/process endpoint if autoLearnEnabled is true on the workspace swarm.
 * This is called when a PR is merged to main/master to automatically update the knowledge base.
 */
async function triggerAutoLearnIfEnabled(
  workspaceId: string,
  repositoryUrl: string,
  githubPat: string | undefined,
  delivery: string | null,
) {
  // Get swarm with autoLearnEnabled flag
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      autoLearnEnabled: true,
      swarmUrl: true,
      swarmApiKey: true,
    },
  });

  if (!swarm?.autoLearnEnabled) {
    console.log("[GithubWebhook] Auto-learn disabled, skipping", {
      delivery,
      workspaceId,
      autoLearnEnabled: swarm?.autoLearnEnabled ?? false,
    });
    return;
  }

  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    console.error("[GithubWebhook] Auto-learn enabled but swarm not fully configured", {
      delivery,
      workspaceId,
      hasSwarmUrl: !!swarm.swarmUrl,
      hasSwarmApiKey: !!swarm.swarmApiKey,
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

  // Decrypt swarm API key
  const enc = EncryptionService.getInstance();
  let decryptedSwarmApiKey: string;
  try {
    const parsed = typeof swarm.swarmApiKey === "string" ? JSON.parse(swarm.swarmApiKey) : swarm.swarmApiKey;
    decryptedSwarmApiKey = enc.decryptField("swarmApiKey", parsed);
  } catch (error) {
    console.error("[GithubWebhook] Failed to decrypt swarm API key for auto-learn", {
      delivery,
      workspaceId,
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
