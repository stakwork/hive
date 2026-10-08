/**
 * Check failures — the first fix is hive's (strut
 * `plans/job-artifact-events.md` §5, "automatic, later"; the door it goes
 * through is `artifact-events.ts`).
 *
 * A second source of artifact events beside the webhook's `pull_request
 * closed`: a check on a job's pull request has completed (`check_run` /
 * `workflow_run`, forwarded by the webhook), or a turn that reported the
 * pull request has just settled (the job-turn handler — the checks may
 * have run while the turn did). Either way hive reads the pull request's
 * live state AS THE JOB'S OWNER — the read the card makes, with the token
 * of whoever's turn it will be — and once every check has run and one has
 * failed, sends the `checks failed` event the card's Fix would
 * (`checksFailedEvent`: the head commit, each failing check with its link)
 * as the job's next turn, or queued on the ref's slot behind a live one
 * (`startEventTurn`). The `Pod` page has the job reproduce, fix in the pod
 * and push to the same pull request.
 *
 * ONCE. The ref's row carries `autoEventAt`: taken atomically before the
 * launch, so the completed events a workflow's last jobs fire within the
 * same second — and a settle running beside them — send one turn, not
 * several; given back when the launch was refused outright, so a strut
 * outage does not spend the one. After it, every fix is a person's click
 * on the card: a job that fixed once and failed again is not re-run on
 * its own — the loop guard, hive's and per artifact, the twin of
 * `STRUT_CHAT_MAX_AUTO_TURNS`. A pull request merged or closed, one whose
 * checks are still running, and one whose checks all passed leave the
 * slot untaken: there is nothing to fix yet, or ever.
 */

import { after } from "next/server";
import { db } from "@/lib/db";
import { getPullRequestStatus } from "@/lib/github/pullRequestStatus";
import { getUserAppTokens } from "@/lib/githubApp";
import { logger } from "@/lib/logger";
import { checksFailedEvent, checksRunning, formatArtifactEvent, parseGithubPullRequestUrl } from "@/lib/strut-jobs";
import { firstJobTurn } from "@/services/strut-jobs";
import { type ArtifactEventOutcome, capEventText, startEventTurn } from "@/services/strut-jobs/artifact-events";

const LOG_TAG = "JOB_CHECK_FAILURE";

export interface CheckFailureSource {
  /** The source's workspace — the webhook route's `[workspaceId]`, the launch's; a ref is matched within it only. */
  workspaceId: string;
  /** The pull request's URL as the source knows it (`https://github.com/<owner>/<name>/pull/<n>`); matched case-insensitively. */
  url: string;
  publicBaseUrl: string;
}

/**
 * What became of each job that reported the pull request and has its one
 * automatic fix still to send: the door's outcome once sent, else why not
 * — `running` (a check still in flight), `clean` (none failed), `over`
 * (merged or closed), `taken` (another delivery sent it first), `unread`
 * (no token for the repository's owner, or GitHub refused the read).
 */
export type CheckFailureOutcome = ArtifactEventOutcome | "running" | "clean" | "over" | "taken" | "unread";

export interface CheckFailureDelivery {
  jobs: Array<{ jobId: string; outcome: CheckFailureOutcome }>;
}

type IndexedRef = { id: string; jobId: string; kind: string; url: string };

/**
 * Every job of the workspace that reported the pull request and has not
 * had its automatic fix: read the live state as the job's owner and send
 * the event once the checks are all in and one failed. One read per job,
 * since each reads with its owner's token; one turn per job.
 */
export async function deliverCheckFailure(source: CheckFailureSource): Promise<CheckFailureDelivery> {
  const jobs: CheckFailureDelivery["jobs"] = [];
  if (!parseGithubPullRequestUrl(source.url)) return { jobs };

  const refs = await db.strutJobArtifact.findMany({
    where: { workspaceId: source.workspaceId, url: { equals: source.url, mode: "insensitive" }, autoEventAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, jobId: true, kind: true, url: true },
  });
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.jobId)) continue;
    seen.add(ref.jobId);
    jobs.push({ jobId: ref.jobId, outcome: await sendOnce(ref, source.publicBaseUrl) });
  }
  if (jobs.length > 0) logger.info("Check failure considered", LOG_TAG, { workspaceId: source.workspaceId, url: source.url, jobs });
  return { jobs };
}

/**
 * `deliverCheckFailure` after the response, never throwing — for the
 * webhook, which must answer GitHub now. A delivery that fails is logged;
 * the next completed check, or the card's Fix, is the backstop.
 */
export function forwardCheckFailure(source: CheckFailureSource): void {
  const run = () =>
    deliverCheckFailure(source).then(
      () => undefined,
      (err: unknown) =>
        logger.warn("Check failure delivery failed (non-fatal)", LOG_TAG, {
          workspaceId: source.workspaceId,
          url: source.url,
          error: err instanceof Error ? err.message : String(err),
        }),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}

async function sendOnce(ref: IndexedRef, publicBaseUrl: string): Promise<CheckFailureOutcome> {
  // The URL as indexed — the one hive settled on — names what to read.
  const pr = parseGithubPullRequestUrl(ref.url);
  if (!pr) return "unread";
  const first = await firstJobTurn(ref.jobId);
  if (!first) return "skipped";

  // The owner's token for the repository's owner: GitHub decides what the
  // job may see, as it will decide what the fix may push.
  const tokens = await getUserAppTokens(first.userId, pr.owner);
  if (!tokens?.accessToken) {
    logger.warn("Check failure not read — no GitHub token for the repository's owner", LOG_TAG, { jobId: ref.jobId, owner: pr.owner });
    return "unread";
  }
  let status: Awaited<ReturnType<typeof getPullRequestStatus>>;
  try {
    // Loaded here, not at the top: the webhook route imports this module,
    // and GitHub's client is for the one read, as `launchJobTurn` loads
    // what it needs when it needs it.
    const { Octokit } = await import("@octokit/rest");
    status = await getPullRequestStatus(new Octokit({ auth: tokens.accessToken }), { owner: pr.owner, repo: pr.name, number: pr.number });
  } catch (err) {
    logger.warn("Check failure not read — GitHub refused", LOG_TAG, { jobId: ref.jobId, url: ref.url, error: err instanceof Error ? err.message : String(err) });
    return "unread";
  }

  if (status.state === "merged" || status.state === "closed") return "over";
  if (checksRunning(status.checks)) return "running";
  const event = checksFailedEvent({ url: ref.url, headSha: status.headSha, checks: status.checks });
  if (!event) return "clean";

  // The one automatic event, taken before the launch: concurrent deliveries
  // — a workflow's last checks completing together, a settle beside them —
  // find it taken and send nothing.
  const { count } = await db.strutJobArtifact.updateMany({ where: { id: ref.id, autoEventAt: null }, data: { autoEventAt: new Date() } });
  if (count === 0) return "taken";

  const text = capEventText(formatArtifactEvent({ kind: ref.kind, url: ref.url, what: event.what }, event.details));
  const outcome = await startEventTurn(ref.jobId, text, ref.id, publicBaseUrl);
  // A launch refused outright (strut down, no conversation) gives the one back: the next completed check tries again.
  if (outcome === "skipped") await db.strutJobArtifact.update({ where: { id: ref.id }, data: { autoEventAt: null } });
  return outcome;
}
