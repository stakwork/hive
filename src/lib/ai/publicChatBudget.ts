import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Public dashboard chat — token-budget rate limiting.
 *
 * Anonymous visitors of a `Workspace.isPublicViewable` workspace can use
 * `/api/ask/quick`, but every turn writes its `usage.{input,output}Tokens`
 * to the visitor's `SharedConversation` row. Before each turn we sum the
 * weighted token cost across all rows that visitor has authored on this
 * workspace in the last 24h and reject if it's over the cap.
 *
 * Two layers run on every public-viewer request:
 *   1. Per-anonymous-id cap — protects against single-visitor abuse.
 *   2. Per-workspace cap (sum across all anonymous visitors) — protects
 *      against botnet/distributed abuse exhausting one workspace's
 *      Anthropic budget.
 *
 * Output tokens are weighted 5x because Anthropic Sonnet output costs
 * ~5x input. The cap is therefore a real cost-cap rather than a
 * volume-cap.
 */

// Anthropic Sonnet pricing as of writing: ~$3 / Mtok input, ~$15 / Mtok
// output. 5:1 weighting keeps the cap close to actual dollar cost.
export const OUTPUT_TOKEN_WEIGHT = 5;

// Per-visitor daily cap (~$3-5 of Anthropic spend at Sonnet rates).
export const ANON_DAILY_TOKEN_CAP = 100_000;

// Per-public-workspace daily cap, summed across all anonymous visitors
// (~$60-100 of Anthropic spend). Members are not included in this sum;
// only rows where userId is null.
export const WORKSPACE_PUBLIC_DAILY_TOKEN_CAP = 2_000_000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stable identifier for an anonymous visitor. Keyed on IP + UA so that
 * two visitors behind the same NAT are at least somewhat distinguishable.
 * Trivially bypassable by switching network/UA — the cap is intended to
 * deter casual abuse, not determined attackers.
 */
export function deriveAnonymousId(req: NextRequest): string {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);
}

function weightedCost(input: number, output: number): number {
  return input + output * OUTPUT_TOKEN_WEIGHT;
}

interface BudgetResult {
  allowed: boolean;
  reason?: "anon" | "workspace";
  retryAfterSecs?: number;
}

/**
 * Sum recent token usage and decide whether this turn may proceed.
 *
 * Note: this is a *pre-flight* check, so a single turn can squeak in
 * a small amount over the cap (we only know the actual cost after
 * `streamText.onFinish` increments the row). Acceptable trade-off —
 * the cap is soft, not strict.
 */
export async function checkPublicChatBudget(args: {
  workspaceId: string;
  anonymousId: string;
}): Promise<BudgetResult> {
  const since = new Date(Date.now() - ONE_DAY_MS);

  const [anonAgg, wsAgg] = await Promise.all([
    db.sharedConversation.aggregate({
      where: {
        anonymousId: args.anonymousId,
        createdAt: { gte: since },
      },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.sharedConversation.aggregate({
      where: {
        workspaceId: args.workspaceId,
        userId: null,
        createdAt: { gte: since },
      },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);

  const anonCost = weightedCost(
    anonAgg._sum.inputTokens ?? 0,
    anonAgg._sum.outputTokens ?? 0,
  );
  if (anonCost >= ANON_DAILY_TOKEN_CAP) {
    return { allowed: false, reason: "anon", retryAfterSecs: 24 * 60 * 60 };
  }

  const wsCost = weightedCost(
    wsAgg._sum.inputTokens ?? 0,
    wsAgg._sum.outputTokens ?? 0,
  );
  if (wsCost >= WORKSPACE_PUBLIC_DAILY_TOKEN_CAP) {
    return { allowed: false, reason: "workspace", retryAfterSecs: 24 * 60 * 60 };
  }

  return { allowed: true };
}

/**
 * Increment the running token totals on a SharedConversation row
 * after a turn completes. Best-effort — we swallow errors so a DB
 * blip doesn't break the user-visible stream (rate limits will
 * still gate the next request based on whatever did persist).
 */
export async function recordTurnTokens(args: {
  conversationId: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  if (!args.inputTokens && !args.outputTokens) return;
  try {
    await db.sharedConversation.update({
      where: { id: args.conversationId },
      data: {
        inputTokens: { increment: Math.max(0, args.inputTokens) },
        outputTokens: { increment: Math.max(0, args.outputTokens) },
      },
    });
  } catch (error) {
    console.error("[recordTurnTokens] failed to persist token usage", {
      conversationId: args.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
