/**
 * Live PR nudge — the org-canvas twin of `strut-jobs/artifact-events.ts`
 * and `check-failures.ts`, but for the PERSON looking at the canvas rather
 * than the job that reported the pull request. Any pull request the canvas
 * can show (`PullRequestInline` / `PullRequestPanel`) polls its live state
 * every 30s through `/api/orgs/[githubLogin]/strut/pull-request` with the
 * viewer's own GitHub token; this just makes that refetch immediate by
 * nudging the org's Pusher channel when GitHub says something changed.
 *
 * Deliberately NOT routed through the strut artifact-event index: that
 * index only knows pull requests a job reported. A PR can be on the canvas
 * without any job ever having touched it, so this resolves the org
 * straight off the workspace instead.
 */

import { after } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasPrUpdated } from "@/lib/pusher";

const LOG_TAG = "CANVAS_PR_LIVE_NOTIFY";

export interface ForwardPrUpdateInput {
  workspaceId: string;
  /** `owner/name`. */
  repoFullName: string;
  number: number;
}

/**
 * Resolves the workspace's org and fires `notifyCanvasPrUpdated` at it.
 * No-ops (quietly) when the workspace has no source-control org — plenty
 * of workspaces don't. Never throws: a webhook delivery must not fail
 * because the live nudge couldn't be sent.
 */
async function deliverPrUpdate({ workspaceId, repoFullName, number }: ForwardPrUpdateInput): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { sourceControlOrg: { select: { githubLogin: true } } },
  });
  const githubLogin = workspace?.sourceControlOrg?.githubLogin;
  if (!githubLogin) return;
  notifyCanvasPrUpdated(githubLogin, { repo: repoFullName, number });
}

/**
 * `deliverPrUpdate` after the response, never throwing — for a webhook
 * that must answer GitHub now and has nowhere to retry from (same
 * `after()`-with-`void run()`-fallback shape as `forwardArtifactEvent`).
 * A delivery that fails is logged; the 30s poll is the backstop.
 */
export function forwardPrUpdate(input: ForwardPrUpdateInput): void {
  const run = () =>
    deliverPrUpdate(input).catch((err: unknown) =>
      logger.warn("forwardPrUpdate failed (non-fatal)", LOG_TAG, {
        workspaceId: input.workspaceId,
        repoFullName: input.repoFullName,
        number: input.number,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
