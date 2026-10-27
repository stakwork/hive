/**
 * "Fix" an ErrorIssue with a strut job.
 *
 * The job is launched exactly like any other strut job (`launchJobTurn`,
 * services/strut-jobs.ts): resolved strut target, the user's GitHub token
 * pushed as the actor secret, one `job` workflow turn. The job's agent
 * investigates the error and opens a pull request on the issue's repository.
 *
 * Dispatch is race-safe: the issue row is claimed with a conditional
 * `updateMany` (fixStatus null or FAILED → DISPATCHING) before anything is
 * launched, so concurrent clicks launch at most one job. A launch that fails
 * releases the claim as FAILED, which is the only state a retry may start from.
 *
 * Status needs no callback of its own: the job's StrutRun rows and the
 * `StrutJobArtifact` index (written when a turn settles) already record
 * what happened, and `refreshErrorFix` derives the issue's fix state from them.
 */

import crypto from "crypto";
import { ErrorFixStatus, StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { JOB_TURN_KIND } from "@/lib/strut-jobs";
import { launchJobTurn } from "@/services/strut-jobs";
import { fetchRedactedBlobContent } from "@/services/error-issues";
import { parseBlobContent } from "@/lib/utils/error-frames";

const LOG_TAG = "ERROR_FIX";

export interface ErrorFixState {
  fixStatus: ErrorFixStatus | null;
  fixJobId: string | null;
  fixPrUrl: string | null;
  fixDispatchedAt: Date | null;
}

export type DispatchErrorFixResult =
  | { status: "dispatched"; fix: ErrorFixState }
  | { status: "exists"; fix: ErrorFixState }
  | { status: "not_found" }
  | { status: "error"; error: string; code: "NO_REPOSITORY" | "LAUNCH_FAILED" };

const FIX_SELECT = { fixStatus: true, fixJobId: true, fixPrUrl: true, fixDispatchedAt: true } as const;

type IssueForPrompt = {
  id: string;
  title: string;
  exceptionType: string;
  repoKey: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  environment: string | null;
  release: string | null;
  metadata: unknown;
};

interface EventForPrompt {
  message: string | null;
  environment: string | null;
  release: string | null;
  commitSha: string | null;
  blobUrl?: string | null;
}

const MAX_STACK_CHARS = 8_000;
const MAX_METADATA_CHARS = 3_000;

export function buildErrorFixPrompt(args: {
  workspaceSlug: string;
  issue: IssueForPrompt;
  event?: EventForPrompt | null;
  stackTrace?: string | null;
  repositoryUrl: string;
  branch: string;
}): string {
  const { workspaceSlug, issue, event, stackTrace, repositoryUrl, branch } = args;
  const lines: string[] = [
    `Investigate this production error in @${workspaceSlug} and fix it. Find the root cause in the code, make the smallest correct change, and open a pull request with the fix against ${repositoryUrl} (base branch \`${branch}\`). Do not open a pull request on any other repository.`,
    "",
    `**Error:** ${issue.title}`,
    `**Exception type:** \`${issue.exceptionType}\``,
  ];
  if (event?.message) lines.push(`**Message:** ${event.message}`);
  lines.push(
    `**Occurrences:** ${issue.occurrenceCount}`,
    `**First seen:** ${issue.firstSeenAt.toISOString()}`,
    `**Last seen:** ${issue.lastSeenAt.toISOString()}`,
  );
  const env = event?.environment ?? issue.environment;
  const release = event?.release ?? issue.release;
  if (env) lines.push(`**Environment:** ${env}`);
  if (release) lines.push(`**Release:** \`${release}\``);
  if (event?.commitSha) lines.push(`**Commit:** \`${event.commitSha}\``);
  lines.push(`**Repository:** ${repositoryUrl}`, `**Workspace:** ${workspaceSlug}`, `**Error issue id:** ${issue.id}`);

  if (issue.metadata && typeof issue.metadata === "object") {
    const json = JSON.stringify(issue.metadata, null, 2);
    if (json && json !== "{}") {
      lines.push("", "**Metadata:**", "```json", json.slice(0, MAX_METADATA_CHARS), "```");
    }
  }
  if (stackTrace) {
    lines.push("", "**Stack trace:**", "```", stackTrace.slice(0, MAX_STACK_CHARS), "```");
  }
  lines.push("", "When the pull request is open, report it so it can be linked to this error.");
  return lines.join("\n");
}

async function loadStackTrace(blobUrl: string | null | undefined): Promise<string | null> {
  if (!blobUrl) return null;
  try {
    const parsed = parseBlobContent(await fetchRedactedBlobContent(blobUrl));
    if (parsed.frames.length > 0) {
      return parsed.frames
        .map((f) => `${f.filename}${f.lineno != null ? `:${f.lineno}` : ""}${f.function ? ` in ${f.function}` : ""}`)
        .join("\n");
    }
    return parsed.stackTrace || null;
  } catch (err) {
    logger.warn("Stack trace fetch failed; dispatching without it", LOG_TAG, { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Dispatch a fix job for the issue. The caller has already checked that the
 * user may write to the issue's workspace.
 */
export async function dispatchErrorFix(args: { issueId: string; userId: string; publicBaseUrl: string }): Promise<DispatchErrorFixResult> {
  const { issueId, userId, publicBaseUrl } = args;

  const issue = await db.errorIssue.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      workspaceId: true,
      repositoryId: true,
      repoKey: true,
      title: true,
      exceptionType: true,
      occurrenceCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      environment: true,
      release: true,
      metadata: true,
      ...FIX_SELECT,
      workspace: { select: { slug: true, sourceControlOrgId: true } },
      repository: { select: { repositoryUrl: true, branch: true } },
    },
  });
  if (!issue) return { status: "not_found" };

  // Cheap pre-check; the conditional claim below is the real guard.
  if (issue.fixStatus && issue.fixStatus !== ErrorFixStatus.FAILED) {
    return { status: "exists", fix: pickFix(issue) };
  }

  // The repository the PR belongs on: the issue's own, else the workspace
  // repository whose url matches the issue's repoKey.
  let repo = issue.repository;
  if (!repo) {
    const candidates = await db.repository.findMany({
      where: { workspaceId: issue.workspaceId },
      select: { repositoryUrl: true, branch: true },
    });
    const { canonicalRepoKey } = await import("@/lib/utils/error-fingerprint");
    repo = candidates.find((r) => canonicalRepoKey(r.repositoryUrl) === issue.repoKey) ?? null;
  }
  if (!repo) {
    return { status: "error", code: "NO_REPOSITORY", error: "No repository in this workspace matches this error, so there is nowhere to open a pull request." };
  }

  const jobId = crypto.randomUUID();
  const now = new Date();
  const claim = await db.errorIssue.updateMany({
    where: { id: issueId, OR: [{ fixStatus: null }, { fixStatus: ErrorFixStatus.FAILED }] },
    data: {
      fixStatus: ErrorFixStatus.DISPATCHING,
      fixJobId: jobId,
      fixPrUrl: null,
      fixDispatchedAt: now,
      fixDispatchedById: userId,
    },
  });
  if (claim.count === 0) {
    const current = await db.errorIssue.findUnique({ where: { id: issueId }, select: FIX_SELECT });
    return current ? { status: "exists", fix: current } : { status: "not_found" };
  }

  const release = async () => {
    await db.errorIssue.updateMany({ where: { id: issueId, fixJobId: jobId }, data: { fixStatus: ErrorFixStatus.FAILED } });
  };

  try {
    const latestEvent = await db.errorEvent.findFirst({
      where: { issueId },
      orderBy: { createdAt: "desc" },
      select: { message: true, environment: true, release: true, commitSha: true, blobUrl: true },
    });
    const stackTrace = await loadStackTrace(latestEvent?.blobUrl);
    const prompt = buildErrorFixPrompt({
      workspaceSlug: issue.workspace.slug,
      issue,
      event: latestEvent,
      stackTrace,
      repositoryUrl: repo.repositoryUrl,
      branch: repo.branch,
    });
    const title = `Fix: ${issue.title || issue.exceptionType}`.slice(0, 120);

    // The job replies into its own conversation (the job-turn handler writes
    // its reply rows there); owned by the clicker, scoped to the org.
    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: issue.workspace.sourceControlOrgId,
        userId,
        workspaceId: null,
        messages: [] as unknown as never,
        title,
        lastMessageAt: now,
        source: "error-fix",
        settings: { extraWorkspaceSlugs: [issue.workspace.slug] } as unknown as never,
        followUpQuestions: [],
        isShared: false,
      },
      select: { id: true },
    });

    const result = await launchJobTurn(
      { userId, workspaceId: issue.workspaceId, conversationId: conversation.id, publicBaseUrl },
      { jobId, title, prompt, started: true },
    );
    if (result.status === "error" || result.status === "busy") {
      await release();
      return { status: "error", code: "LAUNCH_FAILED", error: result.status === "error" ? result.error : result.note };
    }
  } catch (err) {
    logger.error("Error fix dispatch failed", LOG_TAG, { issueId, error: err instanceof Error ? err.message : String(err) });
    await release();
    return { status: "error", code: "LAUNCH_FAILED", error: "The fix job could not be started." };
  }

  await db.errorIssue.updateMany({
    where: { id: issueId, fixJobId: jobId, fixStatus: ErrorFixStatus.DISPATCHING },
    data: { fixStatus: ErrorFixStatus.IN_PROGRESS },
  });
  logger.info("Error fix job dispatched", LOG_TAG, { issueId, jobId });
  return { status: "dispatched", fix: { fixStatus: ErrorFixStatus.IN_PROGRESS, fixJobId: jobId, fixPrUrl: null, fixDispatchedAt: now } };
}

function pickFix(row: ErrorFixState): ErrorFixState {
  return { fixStatus: row.fixStatus, fixJobId: row.fixJobId, fixPrUrl: row.fixPrUrl, fixDispatchedAt: row.fixDispatchedAt };
}

/**
 * Derive and persist the fix state from the job's records: a reported pull
 * request → PR_OPENED; every turn over without one → FAILED (retryable).
 */
export async function refreshErrorFix(issueId: string): Promise<ErrorFixState | null> {
  const issue = await db.errorIssue.findUnique({ where: { id: issueId }, select: FIX_SELECT });
  if (!issue) return null;
  const { fixJobId, fixStatus } = issue;
  if (!fixJobId || !fixStatus || fixStatus === ErrorFixStatus.FAILED) return pickFix(issue);

  const pr = await db.strutJobArtifact.findFirst({
    where: { jobId: fixJobId, kind: "pull_request" },
    orderBy: { updatedAt: "desc" },
    select: { url: true },
  });
  if (pr) {
    if (fixStatus !== ErrorFixStatus.PR_OPENED || issue.fixPrUrl !== pr.url) {
      await db.errorIssue.updateMany({
        where: { id: issueId, fixJobId },
        data: { fixStatus: ErrorFixStatus.PR_OPENED, fixPrUrl: pr.url },
      });
    }
    return { ...pickFix(issue), fixStatus: ErrorFixStatus.PR_OPENED, fixPrUrl: pr.url };
  }
  if (fixStatus === ErrorFixStatus.PR_OPENED) return pickFix(issue);

  // Only judge once the dispatch has had a chance to create its run row.
  if (fixStatus === ErrorFixStatus.IN_PROGRESS) {
    const runs = await db.strutRun.findMany({
      where: { jobId: fixJobId, kind: JOB_TURN_KIND },
      select: { status: true },
    });
    if (runs.length > 0 && runs.every((r) => r.status !== StrutRunStatus.PENDING)) {
      await db.errorIssue.updateMany({
        where: { id: issueId, fixJobId, fixStatus: ErrorFixStatus.IN_PROGRESS },
        data: { fixStatus: ErrorFixStatus.FAILED },
      });
      return { ...pickFix(issue), fixStatus: ErrorFixStatus.FAILED };
    }
  }
  return pickFix(issue);
}
