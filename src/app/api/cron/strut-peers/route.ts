import { NextRequest, NextResponse } from "next/server";

import { runStrutPeersReconcile } from "@/services/strut-peers";

// One pass touches every org strut and every other swarm in its org: a mint
// plus a PUT per peer, and a delegation list per peer (a push per user
// only when one is missing or due). Bounded, but not a few seconds.
export const maxDuration = 300;

/**
 * GET /api/cron/strut-peers — daily (vercel.json), after the delegations cron.
 *
 * Keeps each org strut's peer records (a `lab:peer` token from every other
 * workspace swarm in the org, by slug) and its users' delegations on those
 * swarms' struts, through the org strut's gateway. See
 * `services/strut-peers.ts`. Kill switch: `STRUT_PEERS_CRON_ENABLED=true`
 * turns it on.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.STRUT_PEERS_CRON_ENABLED !== "true") {
      console.log("[CronAPI] Strut peers cron is disabled via STRUT_PEERS_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Strut peers cron is disabled",
        orgsProcessed: 0,
        peersPushed: 0,
        delegationsPushed: 0,
        errors: [],
      });
    }

    // Optional `?org=<githubLogin>` scopes the pass to one org (debugging).
    const org = request.nextUrl.searchParams.get("org") ?? undefined;

    const result = await runStrutPeersReconcile({ org });

    if (!result.success) {
      result.errors.forEach((error, index) => {
        console.error(
          `[CronAPI] Strut peers error ${index + 1}: ${error.org}${error.peer ? `/${error.peer}` : ""}${error.actor ? ` (${error.actor})` : ""} - ${error.error}`,
        );
      });
    }

    return NextResponse.json({
      success: result.success,
      orgsProcessed: result.orgsProcessed,
      peersPushed: result.peersPushed,
      peersUnsupported: result.peersUnsupported,
      delegationsPushed: result.delegationsPushed,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    console.error("[CronAPI] Unhandled error:", error instanceof Error ? error.message : String(error));
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
