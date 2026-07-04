/**
 * Spike / onset detection for ErrorIssue regression correlation.
 *
 * An "onset" is any of:
 *   (a) isNew    — the ErrorIssue was just created for the first time.
 *   (b) isRegression — a RESOLVED issue just received a new occurrence and was reopened.
 *   (c) burst    — ≥ SPIKE_MIN_COUNT events arrived within the last SPIKE_WINDOW_MINUTES.
 *
 * These are the triggers that warrant running the KG correlation service.
 */

import { db } from "@/lib/db";

// ── Configurable thresholds ────────────────────────────────────────────────────
/** Minimum number of events in the trailing window to classify as a burst. */
export const SPIKE_MIN_COUNT = Number(process.env.SPIKE_MIN_COUNT ?? 10);

/** Trailing window length in minutes for burst detection. */
export const SPIKE_WINDOW_MINUTES = Number(process.env.SPIKE_WINDOW_MINUTES ?? 10);

// ── Types ──────────────────────────────────────────────────────────────────────

export type OnsetReason = "new" | "regression" | "burst";

export interface OnsetResult {
  isOnset: boolean;
  reason: OnsetReason | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns the UTC Date that is `SPIKE_WINDOW_MINUTES` ago from `now`.
 * Exposed for testing boundary conditions.
 */
export function spikeWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - SPIKE_WINDOW_MINUTES * 60 * 1000);
}

/**
 * Count how many ErrorEvents for `issueId` were created within the trailing
 * spike window (exclusive lower bound so the boundary event is included).
 */
export async function countRecentEvents(issueId: string, now: Date = new Date()): Promise<number> {
  const windowStart = spikeWindowStart(now);
  return db.errorEvent.count({
    where: {
      issueId,
      createdAt: { gte: windowStart },
    },
  });
}

/**
 * Determine whether an onset event occurred for the given ErrorIssue.
 *
 * @param issueId      - The ErrorIssue id.
 * @param isNew        - True when the issue was just created (first occurrence).
 * @param isRegression - True when the issue was RESOLVED and just reopened.
 * @param now          - Reference timestamp (default: Date.now()); injectable for tests.
 *
 * Fast-path: isNew / isRegression never require a DB query.
 * Burst detection queries ErrorEvent counts only when neither fast-path applies.
 */
export async function detectOnset(
  issueId: string,
  isNew: boolean,
  isRegression: boolean,
  now: Date = new Date(),
): Promise<OnsetResult> {
  if (isNew) {
    return { isOnset: true, reason: "new" };
  }
  if (isRegression) {
    return { isOnset: true, reason: "regression" };
  }

  const recentCount = await countRecentEvents(issueId, now);
  if (recentCount >= SPIKE_MIN_COUNT) {
    return { isOnset: true, reason: "burst" };
  }

  return { isOnset: false, reason: null };
}
