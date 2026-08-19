import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import {
  claimHasPrArtifact,
  parseCreatePrClaim,
  reconcileClaim,
} from "@/lib/proposals/codeChangeCompletion";
import { logger } from "@/lib/logger";

/**
 * Abandon a stuck code-change claim — the explicit escape hatch for a
 * claim whose outcome could not be confirmed (non-deletable failure, a
 * webhook that never arrived and a reconcile that keeps coming back
 * unknown). Deleting the claim Task unblocks the `@@unique([workspaceId,
 * proposalId])` constraint so the proposal can be approved again.
 *
 * Safety sequence:
 *   1. Only the claim's creator (the approver) or a workspace admin may
 *      abandon it.
 *   2. One final `reconcileClaim` pass runs first — if the PR is found,
 *      it is adopted (artifact + card patch) instead of abandoned, and
 *      the claim is NOT deleted.
 *   3. On genuine unknown, the claim is deleted and the response names
 *      the branch to check manually (`pr_branch` from the dispatch
 *      receipt) — the operator owns the residual risk of a PR this
 *      system could not see.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { taskId } = await params;

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      deleted: true,
      createdById: true,
      workspaceId: true,
      proposalId: true,
      codeChangeClaim: true,
    },
  });
  if (!task || task.deleted || !task.proposalId || !task.codeChangeClaim) {
    return NextResponse.json(
      { error: "No abandonable code-change claim found for this task." },
      { status: 404 },
    );
  }

  // Authorization: claim creator, or admin on the claim's workspace.
  if (task.createdById !== userId) {
    const access = await validateWorkspaceAccessById(task.workspaceId, userId);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json(
        {
          error:
            "Only the approver or a workspace admin can abandon this claim.",
        },
        { status: 403 },
      );
    }
  }

  const claim = parseCreatePrClaim(task.codeChangeClaim);

  // A claim that already resolved to a PR is not abandonable — the PR is
  // real and the proposal must stay claimed.
  if (await claimHasPrArtifact(taskId)) {
    return NextResponse.json(
      { error: "This claim already resolved to a pull request." },
      { status: 409 },
    );
  }

  // Final reconcile pass — adopting a found PR beats abandoning it.
  if (claim) {
    try {
      const outcome = await reconcileClaim({ taskId, claim });
      if (outcome !== "unknown") {
        return NextResponse.json(
          {
            error:
              "The claim resolved to a pull request during the final check — " +
              "it was adopted instead of abandoned.",
            outcome,
          },
          { status: 409 },
        );
      }
    } catch (err) {
      // Reconcile infrastructure failure — do not delete on a check we
      // could not actually run.
      logger.error(
        "[code-change-abandon] Final reconcile failed — refusing to abandon",
        "code-change-abandon",
        { taskId, error: String(err) },
      );
      return NextResponse.json(
        { error: "Could not verify the claim's outcome. Try again shortly." },
        { status: 502 },
      );
    }
  }

  await db.task.delete({ where: { id: taskId } });

  logger.warn(
    "[code-change-abandon] Claim abandoned",
    "code-change-abandon",
    {
      taskId,
      userId,
      proposalId: task.proposalId,
      requestId: claim?.requestId,
      prBranch: claim?.prBranch,
    },
  );

  return NextResponse.json({
    success: true,
    message:
      "Claim abandoned — the proposal can be approved again. " +
      (claim?.prBranch
        ? `Before re-approving, check the repository for a branch named '${claim.prBranch}'.`
        : "Before re-approving, check the repository for unexpected swarm/swarm-change-* branches."),
    ...(claim?.prBranch ? { prBranch: claim.prBranch } : {}),
  });
}
