import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSwarmStorageJanitor } from "@/services/swarm/storage-janitor";

/**
 * GET /api/cron/swarm-storage-janitor
 * Vercel cron: capture one host-storage snapshot per running swarm instance.
 * Schedule: "0 3 * * *" (03:00 UTC daily)
 *
 * Auth is hardened vs the naive `Bearer ${CRON_SECRET}` equality check:
 * missing/empty secret is rejected (never compared against `Bearer undefined`),
 * and the bearer is compared with timingSafeEqual on SHA-256 digests.
 */

export const maxDuration = 300;

const LOG_PREFIX = "[HostStorage]";

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
    const summary = await runSwarmStorageJanitor();
    return NextResponse.json(summary);
  } catch {
    console.error(`${LOG_PREFIX} janitor cron unhandled error`);
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
