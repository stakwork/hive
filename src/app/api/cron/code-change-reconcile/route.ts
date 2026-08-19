import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ArtifactType, Prisma, TaskSourceType } from "@prisma/client";
import {
  parseCreatePrClaim,
  reconcileClaim,
} from "@/lib/proposals/codeChangeCompletion";
import { logger } from "@/lib/logger";

/**
 * Reconcile cron for async code-change claims — the backstop for a
 * terminal webhook that never arrived (network drop past the swarm's
 * retry ladder, a Hive deploy mid-delivery, a swarm container that died
 * without its shutdown drain).
 *
 * Sweeps claim Tasks that:
 *   - carry a `codeChangeClaim` dispatch receipt,
 *   - have NO `PULL_REQUEST` artifact yet,
 *   - are older than `MIN_AGE_MS` (webhooks land within seconds-to-minutes;
 *     sweeping younger claims would race the webhook for no benefit), and
 *   - are younger than `MAX_AGE_MS` (a claim unresolvable for a week will
 *     not resolve on the hundredth try — those need the manual abandon
 *     path, and sweeping them forever just burns GitHub quota).
 *
 * Each is resolved via `reconcileClaim` → `reconcilePr`: swarm `/progress`
 * cache first, then a GitHub query on the exact `pr_branch` from the
 * dispatch receipt. Never re-dispatches — a duplicate PR is worse than a
 * pending claim.
 *
 * Enabled by default; set `CODE_CHANGE_RECONCILE_CRON_ENABLED=false` to
 * disable (this cron is a safety net — opt-out, not opt-in).
 */

const MIN_AGE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CLAIMS_PER_RUN = 20;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.CODE_CHANGE_RECONCILE_CRON_ENABLED === "false") {
      return NextResponse.json({
        success: true,
        message: "Code-change reconcile cron is disabled",
        stats: { swept: 0, landed: 0, unknown: 0, skipped: 0 },
      });
    }

    const now = Date.now();
    const candidates = await db.task.findMany({
      where: {
        deleted: false,
        sourceType: TaskSourceType.SYSTEM,
        proposalId: { not: null },
        codeChangeClaim: { not: Prisma.DbNull },
        createdAt: {
          lt: new Date(now - MIN_AGE_MS),
          gt: new Date(now - MAX_AGE_MS),
        },
        chatMessages: {
          none: { artifacts: { some: { type: ArtifactType.PULL_REQUEST } } },
        },
      },
      select: { id: true, codeChangeClaim: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_CLAIMS_PER_RUN,
    });

    const stats = { swept: 0, landed: 0, unknown: 0, skipped: 0 };

    for (const task of candidates) {
      const claim = parseCreatePrClaim(task.codeChangeClaim);
      if (!claim) {
        stats.skipped++;
        continue;
      }
      stats.swept++;
      try {
        const outcome = await reconcileClaim({ taskId: task.id, claim });
        if (outcome === "landed") stats.landed++;
        else if (outcome === "unknown") stats.unknown++;
      } catch (err) {
        stats.unknown++;
        logger.error(
          "[CodeChangeReconcileCron] reconcileClaim threw",
          "code-change-reconcile",
          { taskId: task.id, error: String(err) },
        );
      }
    }

    if (stats.swept > 0) {
      logger.info(
        "[CodeChangeReconcileCron] Sweep complete",
        "code-change-reconcile",
        stats,
      );
    }

    return NextResponse.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "[CodeChangeReconcileCron] Unhandled error",
      "code-change-reconcile",
      { error: errorMessage },
    );
    return NextResponse.json(
      { success: false, error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
