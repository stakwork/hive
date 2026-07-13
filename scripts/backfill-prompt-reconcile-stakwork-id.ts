/**
 * Reconcile Hive Prompt rows that have stakworkId IS NULL.
 *
 * Some prompts were pushed to Stakwork on creation but the returned id was never
 * written back to the Hive row (e.g. the write-back failed silently). Those rows
 * have stakworkId = null while Stakwork already holds the prompt. This leaves
 * future updates/publishes broken (both branch on prompt.stakworkId) and risks
 * accidental re-creates.
 *
 * This script is idempotent: it only targets rows where stakworkId IS NULL.
 * Reconciled rows are updated to stakworkId + syncStatus=OK and drop out of the
 * query on a re-run. Unresolvable rows are durably flagged as syncStatus=FAILED
 * so operators can query them via the existing @@index([syncStatus]).
 *
 * Usage:
 *   npm run backfill:prompt-stakwork-id
 *   (or: npx dotenv-cli -e .env.prod -- npm run backfill:prompt-stakwork-id)
 *
 * Pre-flight: STAKWORK_API_KEY and STAKWORK_BASE_URL must be set in the environment.
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

// Import after dotenv so env vars are populated
import { config } from "../src/config/env";
import {
  buildStakworkPromptIndexByName,
  resolveStakworkPromptId,
} from "../src/services/prompts/prompt-sync";

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;

// ── Pre-flight guards (fail loud, not silently) ───────────────────────────────

if (!config.STAKWORK_API_KEY) {
  throw new Error(
    "STAKWORK_API_KEY is required for prompt reconciliation. " +
      "Set the environment variable in .env.local or the current environment.",
  );
}
if (!config.STAKWORK_BASE_URL) {
  throw new Error(
    "STAKWORK_BASE_URL is required for prompt reconciliation. " +
      "Set the environment variable in .env.local or the current environment.",
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

async function main() {
  console.info("[backfill:prompt-stakwork-id] Starting reconciliation");
  console.info(`[backfill:prompt-stakwork-id] Using STAKWORK_BASE_URL: ${config.STAKWORK_BASE_URL}`);

  // Build the Stakwork index ONCE for the entire run (~one HTTP call per page)
  console.info("[backfill:prompt-stakwork-id] Fetching Stakwork prompt index...");
  const index = await buildStakworkPromptIndexByName();
  console.info(
    `[backfill:prompt-stakwork-id] Index built — ${index.size} unique prompt names across all Stakwork entries`,
  );

  const totals = { reconciled: 0, flagged: 0, failed: 0 };
  let batchNum = 0;
  let cursor: string | undefined;

  for (;;) {
    // Cursor-paginated query — only prompts with stakworkId IS NULL
    const prompts = await prisma.prompt.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { stakworkId: null },
      orderBy: { id: "asc" },
      include: { versions: { select: { id: true } } },
    });

    if (prompts.length === 0) break;
    batchNum++;

    const batchTotals = { reconciled: 0, flagged: 0, failed: 0 };

    for (const prompt of prompts) {
      try {
        const result = await resolveStakworkPromptId(prompt, index);

        if ("id" in result) {
          // Positive match — relink and mark OK
          await prisma.prompt.update({
            where: { id: prompt.id },
            data: {
              stakworkId: result.id,
              syncStatus: "OK",
              lastSyncedAt: new Date(),
            },
          });
          batchTotals.reconciled++;
          console.info(
            `[backfill:prompt-stakwork-id] Reconciled: "${prompt.name}" → stakworkId=${result.id} (verified=${result.verified})`,
          );
        } else {
          // No safe match — flag durably so operators can query syncStatus=FAILED
          await prisma.prompt.update({
            where: { id: prompt.id },
            data: { syncStatus: "FAILED" },
          });
          batchTotals.flagged++;
          console.info(
            `[backfill:prompt-stakwork-id] Flagged: "${prompt.name}" — reason=${result.reason}`,
          );
        }
      } catch (err) {
        // Per-row error: log name and a safe message only — never log the error object
        // itself (it may carry request context including the Authorization header)
        batchTotals.failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.info(
          `[backfill:prompt-stakwork-id] Failed: "${prompt.name}" — ${message}`,
        );
      }
    }

    totals.reconciled += batchTotals.reconciled;
    totals.flagged += batchTotals.flagged;
    totals.failed += batchTotals.failed;

    console.info(
      `[backfill:prompt-stakwork-id] batch ${batchNum}: +${batchTotals.reconciled} reconciled, +${batchTotals.flagged} flagged, +${batchTotals.failed} failed` +
        ` (running totals: reconciled=${totals.reconciled} flagged=${totals.flagged} failed=${totals.failed})`,
    );

    cursor = prompts[prompts.length - 1].id;
    if (prompts.length < BATCH_SIZE) break;
  }

  console.info(
    `[backfill:prompt-stakwork-id] done — reconciled=${totals.reconciled} flagged=${totals.flagged} failed=${totals.failed}`,
  );
  process.exit(totals.failed > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backfill:prompt-stakwork-id] Fatal error: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
