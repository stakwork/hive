import { NextRequest, NextResponse, after } from "next/server";
import { logger } from "@/lib/logger";
import { runJarvisMirror } from "@/services/jarvis-mirror-cron";

// Allow up to 5 minutes; one pass is bounded by maxPerType per workspace.
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

  const depth = Number(request.nextUrl.searchParams.get("d") ?? "0") || 0;

  logger.info(`[JARVIS MIRROR] cron invoked (depth=${depth})`, "JARVIS_MIRROR");

  const result = await runJarvisMirror();

  // Self-chain to drain a backlog quickly: if a batch was capped, immediately
  // trigger another run that resumes from the advanced cursors.
  if (result.anyCapped && depth < MAX_CHAIN_DEPTH) {
    const url = new URL(request.url);
    url.searchParams.set("d", String(depth + 1));
    const headers: Record<string, string> = {};
    if (process.env.CRON_SECRET) headers["authorization"] = `Bearer ${process.env.CRON_SECRET}`;

    after(async () => {
      try {
        await fetch(url.toString(), { headers });
      } catch (error) {
        logger.warn("[JARVIS MIRROR] self-chain trigger failed", "JARVIS_MIRROR", { error });
      }
    });
  }

  // Surface a quick error sample so a manual curl is self-diagnostic.
  const errorSamples = result.results
    .flatMap((r) => r.errors ?? [])
    .slice(0, 10);

  return NextResponse.json({
    success: true,
    processed: result.processed,
    anyCapped: result.anyCapped,
    chained: result.anyCapped && depth < MAX_CHAIN_DEPTH,
    errorCount: result.results.reduce((n, r) => n + (r.errors?.length ?? 0), 0),
    errorSamples,
    results: result.results,
  });
}
