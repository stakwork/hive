/**
 * Backfill Feature→Concept (`implemented-by`) UrnEdges to completion.
 *
 * Runs the resumable backfill in-process, looping batches until done. Because
 * it does NOT go through the serverless HTTP route, there is no
 * FUNCTION_INVOCATION_TIMEOUT — it just runs until every feature is processed.
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/backfill-feature-concepts.ts <orgId> [workspaceId]
 *
 * Options (env or flags):
 *   --batch=N     features per batch (default 50)
 *   --budget=MS   per-batch wall-clock budget in ms (default 120000)
 *
 * Requires DATABASE_URL and the swarm encryption key (the backfill decrypts
 * each workspace's swarm API key to call stakgraph) — provide via .env.prod.
 */

import { backfillFeatureConceptEdges } from "@/lib/graph-walker";

function parseFlag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const orgId = positional[0];
  const workspaceId = positional[1];

  if (!orgId) {
    console.error(
      "Usage: tsx scripts/backfill-feature-concepts.ts <orgId> [workspaceId] [--batch=N] [--budget=MS]",
    );
    process.exit(1);
  }

  const batchSize = parseFlag("batch") ? Number(parseFlag("batch")) : undefined;
  const budgetMs = parseFlag("budget") ? Number(parseFlag("budget")) : undefined;

  let cursor: string | undefined;
  let batch = 0;
  const totals = { featuresProcessed: 0, edgesUpserted: 0, skipped: 0, skippedNoRefId: 0 };

  console.info(`[backfill] starting org=${orgId}${workspaceId ? ` workspace=${workspaceId}` : ""}`);

  for (;;) {
    const res = await backfillFeatureConceptEdges({ orgId, workspaceId, cursor, batchSize, budgetMs });
    batch++;
    totals.featuresProcessed += res.featuresProcessed;
    totals.edgesUpserted += res.edgesUpserted;
    totals.skipped += res.skipped;
    totals.skippedNoRefId += res.skippedNoRefId;

    console.info(
      `[backfill] batch ${batch}: +${res.featuresProcessed} features, +${res.edgesUpserted} edges ` +
        `(running totals: ${totals.featuresProcessed} features, ${totals.edgesUpserted} edges) ` +
        `${res.hasMore ? `→ continuing after ${res.nextCursor}` : "→ done"}`,
    );

    if (!res.hasMore) break;
    cursor = res.nextCursor ?? undefined;
    if (!cursor) {
      console.warn("[backfill] hasMore was true but no cursor returned — stopping to avoid a loop");
      break;
    }
  }

  console.info("[backfill] complete", totals);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
