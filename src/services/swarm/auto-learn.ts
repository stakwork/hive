import { RepositoryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { stakgraphToRepositoryStatus } from "@/utils/conversions";

/**
 * Auto-learn is the swarm MCP `POST /gitree/process` run that summarizes a repository's pull
 * requests into Concepts and links them to File nodes.
 *
 * It must not run alongside the stakgraph sync for the same push: the gitree run ends with a
 * bulk PullRequest->File linker that holds Neo4j write locks on File nodes (package.json, ...)
 * for minutes, while the sync's final step merges edges onto the same nodes. So a push does not
 * fire gitree. It records the sync's `request_id` on the repository
 * (`Repository.pendingAutoLearnRequestId`) and the stakgraph completion webhook for that request
 * fires gitree once the sync is over, whether it ended `Complete` or `Failed`.
 *
 * Fallbacks, so that auto-learn is never lost:
 * - no sync was started (stakgraph busy, trigger failed): fire immediately, unless this
 *   repository already waits on an in-flight sync whose webhook will run it;
 * - a push finds a marker older than {@link AUTO_LEARN_STALE_MS} (the webhook never came):
 *   fire immediately and re-point the marker at the new sync.
 */

/** A pending marker older than this is treated as orphaned: the stakgraph webhook never came. */
export const AUTO_LEARN_STALE_MS = 30 * 60 * 1000;

const LOG = "[AutoLearn]";

export type AutoLearnReason = "sync-complete" | "sync-failed" | "sync-not-started" | "stale-marker";

export function getGitreeBaseUrl(swarmUrl: string): string {
  const swarmUrlObj = new URL(swarmUrl);
  if (swarmUrl.includes("localhost")) {
    return "http://localhost:3355";
  }
  return `https://${swarmUrlObj.hostname}:3355`;
}

export interface TriggerAutoLearnParams {
  workspaceId: string;
  repositoryUrl: string;
  swarmUrl: string | null;
  /** Decrypted swarm API key, sent as `x-api-token`. */
  swarmApiKey: string;
  githubPat: string | undefined;
  reason: AutoLearnReason;
  /** Correlation ids for logs only (GitHub delivery, stakgraph request id). */
  context?: Record<string, string | null | undefined>;
}

/**
 * Fire-and-forget `POST /gitree/process` on the swarm MCP. Returns true when a request was
 * dispatched. The GitHub token travels only in the request itself and is never logged.
 */
export function triggerAutoLearn(params: TriggerAutoLearnParams): boolean {
  const { workspaceId, repositoryUrl, swarmUrl, swarmApiKey, githubPat, reason, context = {} } = params;
  const logContext = { ...context, workspaceId, reason };

  if (!swarmUrl) {
    console.error(`${LOG} Auto-learn enabled but swarm URL not configured`, logContext);
    return false;
  }

  if (!githubPat) {
    console.error(`${LOG} Auto-learn enabled but no GitHub PAT available`, logContext);
    return false;
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(repositoryUrl));
  } catch (error) {
    console.error(`${LOG} Failed to parse repository URL for auto-learn`, { ...logContext, repositoryUrl, error });
    return false;
  }

  let baseSwarmUrl: string;
  try {
    baseSwarmUrl = getGitreeBaseUrl(swarmUrl);
  } catch (error) {
    console.error(`${LOG} Invalid swarm URL for auto-learn`, { ...logContext, error });
    return false;
  }

  const gitreeUrl =
    `${baseSwarmUrl}/gitree/process` +
    `?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` +
    `&token=${encodeURIComponent(githubPat)}&summarize=true&link=true`;

  console.log(`${LOG} Triggering auto-learn gitree/process`, { ...logContext, owner, repo });

  fetch(gitreeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
  })
    .then((response) => {
      if (!response.ok) {
        console.error(`${LOG} Auto-learn gitree/process failed`, { ...logContext, status: response.status });
      } else {
        console.log(`${LOG} Auto-learn gitree/process initiated successfully`, logContext);
      }
    })
    .catch((error) => {
      console.error(`${LOG} Auto-learn gitree/process request failed`, { ...logContext, error });
    });

  return true;
}

export interface PushAutoLearnInput {
  repository: {
    id: string;
    repositoryUrl: string;
    pendingAutoLearnRequestId: string | null;
    pendingAutoLearnAt: Date | null;
  };
  workspaceId: string;
  swarm: { autoLearnEnabled: boolean | null; swarmUrl: string | null };
  /** Decrypted swarm API key. */
  swarmApiKey: string;
  githubPat: string | undefined;
  /** `request_id` from `/sync_async`; undefined when stakgraph rejected the sync or the call failed. */
  syncRequestId: string | undefined;
  delivery: string | null;
  now?: Date;
}

export type PushAutoLearnOutcome = "disabled" | "deferred" | "fired-stale-then-deferred" | "kept-pending" | "fired";

/**
 * Push-side half of the hand-off: record the intent to auto-learn after the sync that this push
 * started, or fire right away when there is no sync to wait for.
 */
export async function scheduleAutoLearnForPush(input: PushAutoLearnInput): Promise<PushAutoLearnOutcome> {
  const { repository, workspaceId, swarm, swarmApiKey, githubPat, syncRequestId, delivery } = input;
  const now = input.now ?? new Date();
  const context = { delivery, workspaceId, repositoryUrl: repository.repositoryUrl };

  if (!swarm.autoLearnEnabled) {
    console.log(`${LOG} Auto-learn disabled, skipping`, {
      ...context,
      autoLearnEnabled: swarm.autoLearnEnabled ?? false,
    });
    return "disabled";
  }

  const pendingRequestId = repository.pendingAutoLearnRequestId;
  const pendingSince = pendingRequestId ? repository.pendingAutoLearnAt : null;
  const pendingIsStale =
    !!pendingRequestId && (!pendingSince || now.getTime() - pendingSince.getTime() >= AUTO_LEARN_STALE_MS);

  const fire = (reason: AutoLearnReason) =>
    triggerAutoLearn({
      workspaceId,
      repositoryUrl: repository.repositoryUrl,
      swarmUrl: swarm.swarmUrl,
      swarmApiKey,
      githubPat,
      reason,
      context: { delivery, pendingRequestId },
    });

  if (syncRequestId) {
    if (pendingIsStale) {
      console.warn(`${LOG} Pending auto-learn marker is stale (webhook never came), firing now`, {
        ...context,
        pendingRequestId,
        pendingSince,
      });
      fire("stale-marker");
    }

    // Point the marker at the new sync. A fresh marker keeps its original wait start, so a swarm
    // whose webhooks never arrive still trips the stale path under continuous pushes.
    const pendingAutoLearnAt = pendingRequestId && !pendingIsStale && pendingSince ? pendingSince : now;
    await db.repository.update({
      where: { id: repository.id },
      data: { pendingAutoLearnRequestId: syncRequestId, pendingAutoLearnAt },
    });
    console.log(`${LOG} Auto-learn deferred until the stakgraph sync completes`, {
      ...context,
      requestId: syncRequestId,
      supersededRequestId: pendingRequestId ?? null,
    });
    return pendingIsStale ? "fired-stale-then-deferred" : "deferred";
  }

  // No sync was started (stakgraph busy or the trigger failed): there is no webhook to wait for.
  if (pendingRequestId && !pendingIsStale) {
    console.log(`${LOG} Sync not started; auto-learn already pending on an in-flight sync`, {
      ...context,
      pendingRequestId,
      pendingSince,
    });
    return "kept-pending";
  }

  console.log(`${LOG} Sync not started; firing auto-learn immediately`, {
    ...context,
    stalePendingRequestId: pendingIsStale ? pendingRequestId : null,
  });
  fire(pendingIsStale ? "stale-marker" : "sync-not-started");

  if (pendingRequestId) {
    await db.repository.updateMany({
      where: { id: repository.id, pendingAutoLearnRequestId: pendingRequestId },
      data: { pendingAutoLearnRequestId: null, pendingAutoLearnAt: null },
    });
  }
  return "fired";
}

export interface PendingAutoLearnInput {
  /** The swarm as returned by the HMAC-verified lookup; nothing else from the payload is trusted. */
  swarm: { id: string; workspaceId: string };
  requestId: string;
  status: string;
}

export interface PendingAutoLearnResult {
  /** False when the status is not `Complete`/`Failed`; nothing is done then. */
  terminal: boolean;
  matched: number;
  fired: number;
}

/**
 * Webhook-side half of the hand-off: once the stakgraph sync `requestId` is over, fire gitree
 * for every repository of the verified swarm's workspace that was waiting on it, and clear the
 * marker. Each repository is claimed atomically, so a redelivered webhook fires nothing twice.
 */
export async function runPendingAutoLearn({
  swarm,
  requestId,
  status,
}: PendingAutoLearnInput): Promise<PendingAutoLearnResult> {
  const repositoryStatus = stakgraphToRepositoryStatus(status);
  const terminal = repositoryStatus === RepositoryStatus.SYNCED || repositoryStatus === RepositoryStatus.FAILED;
  if (!terminal) {
    return { terminal: false, matched: 0, fired: 0 };
  }

  const context = { requestId, status, workspaceId: swarm.workspaceId, swarmId: swarm.id };

  const repositories = await db.repository.findMany({
    where: { workspaceId: swarm.workspaceId, pendingAutoLearnRequestId: requestId },
    select: { id: true, repositoryUrl: true },
  });
  if (repositories.length === 0) {
    return { terminal: true, matched: 0, fired: 0 };
  }

  const swarmRow = await db.swarm.findUnique({
    where: { id: swarm.id },
    select: { workspaceId: true, swarmUrl: true, swarmApiKey: true, autoLearnEnabled: true },
  });
  if (!swarmRow || swarmRow.workspaceId !== swarm.workspaceId) {
    console.error(`${LOG} Swarm not found for pending auto-learn`, context);
    return { terminal: true, matched: repositories.length, fired: 0 };
  }

  const claim = (repositoryId: string) =>
    db.repository.updateMany({
      where: { id: repositoryId, pendingAutoLearnRequestId: requestId },
      data: { pendingAutoLearnRequestId: null, pendingAutoLearnAt: null },
    });

  if (!swarmRow.autoLearnEnabled) {
    for (const repository of repositories) {
      await claim(repository.id);
    }
    console.log(`${LOG} Auto-learn disabled since the sync was triggered, dropping pending run`, {
      ...context,
      repositories: repositories.map((repository) => repository.repositoryUrl),
    });
    return { terminal: true, matched: repositories.length, fired: 0 };
  }

  let swarmApiKey: string;
  try {
    swarmApiKey = swarmRow.swarmApiKey
      ? EncryptionService.getInstance().decryptField("swarmApiKey", swarmRow.swarmApiKey)
      : "";
  } catch (error) {
    console.error(`${LOG} Failed to decrypt swarm API key for pending auto-learn`, { ...context, error });
    return { terminal: true, matched: repositories.length, fired: 0 };
  }

  const workspace = await db.workspace.findUnique({
    where: { id: swarm.workspaceId },
    select: { ownerId: true, slug: true },
  });
  let githubPat: string | undefined;
  if (workspace?.ownerId) {
    const creds = await getGithubUsernameAndPAT(workspace.ownerId, workspace.slug);
    githubPat = creds?.token;
  }

  const reason: AutoLearnReason = repositoryStatus === RepositoryStatus.FAILED ? "sync-failed" : "sync-complete";
  let fired = 0;
  for (const repository of repositories) {
    const claimed = await claim(repository.id);
    if (claimed.count === 0) {
      console.log(`${LOG} Pending auto-learn already consumed`, {
        ...context,
        repositoryUrl: repository.repositoryUrl,
      });
      continue;
    }
    const dispatched = triggerAutoLearn({
      workspaceId: swarm.workspaceId,
      repositoryUrl: repository.repositoryUrl,
      swarmUrl: swarmRow.swarmUrl,
      swarmApiKey,
      githubPat,
      reason,
      context: { requestId },
    });
    if (dispatched) fired += 1;
  }

  console.log(`${LOG} Pending auto-learn processed after sync`, { ...context, matched: repositories.length, fired });
  return { terminal: true, matched: repositories.length, fired };
}
