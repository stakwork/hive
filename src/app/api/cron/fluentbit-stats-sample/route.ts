import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runFluentbitStatsSampler } from "@/services/swarm/fluentbit-stats-sample";

/**
 * GET /api/cron/fluentbit-stats-sample
 * Vercel cron: capture one FluentBit-stats sample per running swarm instance.
 * Schedule: "45 * * * *" (hourly, 45 minutes past the hour UTC — offset from
 * the minute-0 swarm-storage-janitor so login+cmd load does not stack).
 *
 * Auth is hardened vs the naive `Bearer ${CRON_SECRET}` equality check:
 * missing/empty secret is rejected (never compared against `Bearer undefined`),
 * and the bearer is compared with timingSafeEqual on SHA-256 digests.
 */

export const maxDuration = 300;

const LOG_PREFIX = "[FluentbitStats]";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = createHash("sha256").update(authHeader).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runFluentbitStatsSampler();
    return NextResponse.json(summary);
  } catch {
    console.error(`${LOG_PREFIX} sampler cron unhandled error`);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
