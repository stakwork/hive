import { NextRequest, NextResponse, after } from "next/server";
import { logger } from "@/lib/logger";
import { runJarvisPrLink } from "@/services/jarvis-pr-link-cron";

// Allow up to 5 minutes; one pass is bounded by maxPerRun per workspace.
export const maxDuration = 300;

// How many times the job may self-chain in a single drain to avoid runaway loops.
const MAX_CHAIN_DEPTH = 20;

export async function GET(request: NextRequest) {
  // Verify cron authorization (Vercel cron header OR CRON_SECRET bearer).
  const isVercelCron = request.headers.get("x-vercel-cron");
  const authHeader = request.headers.get("authorization");

  if (!isVercelCron && process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Opt-in kill switch so the code can ship dark and be turned on only once the
  // PullRequest graph-node shape is confirmed (repo/number resolution) and the
  // jarvis-backend RESULTED_IN edge schema is deployed.
  if (process.env.JARVIS_PR_LINK_CRON_ENABLED !== "true") {
    logger.info("[JARVIS PR LINK] disabled via JARVIS_PR_LINK_CRON_ENABLED", "JARVIS_PR_LINK");
    return NextResponse.json({ success: true, disabled: true, processed: 0 });
  }

  const depth = Number(request.nextUrl.searchParams.get("d") ?? "0") || 0;

  logger.info(`[JARVIS PR LINK] cron invoked (depth=${depth})`, "JARVIS_PR_LINK");

  const result = await runJarvisPrLink();

  // Self-chain to drain a backlog quickly: if a batch was capped, immediately
  // trigger another run that resumes against still-unlinked tasks.
  if (result.anyCapped && depth < MAX_CHAIN_DEPTH) {
    const url = new URL(request.url);
    url.searchParams.set("d", String(depth + 1));
    const headers: Record<string, string> = {};
    if (process.env.CRON_SECRET) headers["authorization"] = `Bearer ${process.env.CRON_SECRET}`;

    after(async () => {
      try {
        await fetch(url.toString(), { headers });
      } catch (error) {
        logger.warn("[JARVIS PR LINK] self-chain trigger failed", "JARVIS_PR_LINK", { error });
      }
    });
  }

  return NextResponse.json({
    success: true,
    processed: result.processed,
    anyCapped: result.anyCapped,
    chained: result.anyCapped && depth < MAX_CHAIN_DEPTH,
    results: result.results,
  });
}
