/**
 * Prompt daily runs sync service.
 * Pulls yesterday's prompt run counts from Stakwork and upserts them locally,
 * linking each row to the parent Prompt via PromptVersion resolution.
 */

import { db } from "@/lib/db";
import { config } from "@/config/env";
import { logger } from "@/lib/logger";
import { stakworkHeaders } from "./prompt-sync";

const LOG_PREFIX = "[PromptDailyRunsCron]";
const MAX_PAGES = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StakworkDailyRunRow {
  id: number;
  prompt_id: number;
  prompt_version_id: number;
  workflow_id: number;
  customer_id: number;
  run_date: string; // ISO date string "YYYY-MM-DD"
  run_count: number;
  hive_version_id: string;
  created_at: string;
  updated_at: string;
}

interface StakworkDailyRunsResponse {
  success: boolean;
  data: {
    total: number;
    size: number;
    prompt_daily_runs: StakworkDailyRunRow[];
  };
}

export interface SyncPromptDailyRunsResult {
  targetDate: string;
  pulled: number;
  upserted: number;
  skipped: number;
  errors: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function yesterdayUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function syncPromptDailyRuns(
  targetDate?: Date,
): Promise<SyncPromptDailyRunsResult> {
  const date = targetDate ?? yesterdayUtc();
  const dateStr = toUtcDateString(date);

  logger.info(`${LOG_PREFIX} Starting sync for run_date=${dateStr}`);

  const result: SyncPromptDailyRunsResult = {
    targetDate: dateStr,
    pulled: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    const allRows: StakworkDailyRunRow[] = [];
    let page = 1;
    let total = 0;

    // ── Paginate until we have all rows or hit the safety cap ────────────────
    while (page <= MAX_PAGES) {
      const url = `${config.STAKWORK_BASE_URL}/prompt_daily_runs?run_date=${dateStr}&page=${page}`;

      let resp: Response;
      try {
        resp = await fetch(url, { headers: stakworkHeaders() });
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        logger.warn(`${LOG_PREFIX} Network error on page ${page}: ${msg}. Aborting fetch.`);
        result.errors++;
        break;
      }

      if (!resp.ok) {
        logger.warn(
          `${LOG_PREFIX} Stakwork returned ${resp.status} on page ${page}. Aborting fetch.`,
        );
        result.errors++;
        break;
      }

      let body: StakworkDailyRunsResponse;
      try {
        body = (await resp.json()) as StakworkDailyRunsResponse;
      } catch {
        logger.warn(`${LOG_PREFIX} Failed to parse JSON on page ${page}. Aborting fetch.`);
        result.errors++;
        break;
      }

      if (!body.success || !body.data) {
        logger.warn(`${LOG_PREFIX} Unexpected response shape on page ${page}. Aborting fetch.`);
        result.errors++;
        break;
      }

      const { prompt_daily_runs, size, total: pageTotal } = body.data;

      // Set total on first page; it shouldn't change between pages
      if (page === 1) {
        total = pageTotal;
        logger.info(`${LOG_PREFIX} Total rows reported by Stakwork: ${total}`);
      }

      if (size === 0 || prompt_daily_runs.length === 0) {
        logger.info(`${LOG_PREFIX} Empty page ${page}, stopping pagination.`);
        break;
      }

      allRows.push(...prompt_daily_runs);
      logger.info(
        `${LOG_PREFIX} Fetched page ${page}: ${prompt_daily_runs.length} rows (accumulated ${allRows.length}/${total})`,
      );

      if (allRows.length >= total) {
        break;
      }

      page++;
    }

    result.pulled = allRows.length;
    logger.info(`${LOG_PREFIX} Fetched ${allRows.length} rows across ${page} page(s) for ${dateStr}`);

    // ── Resolve and upsert each row ───────────────────────────────────────────
    const skippedIds: string[] = [];

    for (const row of allRows) {
      const hiveVersionId = row.hive_version_id;

      // Resolve hive_version_id → PromptVersion + parent promptId
      const version = await db.promptVersion.findUnique({
        where: { id: hiveVersionId },
        select: { id: true, promptId: true },
      });

      if (!version) {
        logger.warn(
          `${LOG_PREFIX} Skipping row — no PromptVersion found for hive_version_id="${hiveVersionId}"`,
        );
        skippedIds.push(hiveVersionId);
        result.skipped++;
        continue;
      }

      const runDate = new Date(row.run_date);

      await db.promptDailyRun.upsert({
        where: {
          promptId_versionId_runDate: {
            promptId: version.promptId,
            versionId: version.id,
            runDate,
          },
        },
        create: {
          promptId: version.promptId,
          versionId: version.id,
          stakworkPromptId: row.prompt_id,
          stakworkVersionId: row.prompt_version_id,
          workflowId: row.workflow_id,
          customerId: row.customer_id,
          runDate,
          runCount: row.run_count,
          hiveVersionId,
        },
        update: {
          stakworkPromptId: row.prompt_id,
          stakworkVersionId: row.prompt_version_id,
          workflowId: row.workflow_id,
          customerId: row.customer_id,
          runCount: row.run_count,
          hiveVersionId,
        },
      });

      result.upserted++;
    }

    if (skippedIds.length > 0) {
      logger.warn(
        `${LOG_PREFIX} Skipped ${skippedIds.length} row(s) with unresolved hive_version_id: ${skippedIds.join(", ")}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`${LOG_PREFIX} Unexpected error during sync: ${msg}`);
    result.errors++;
  }

  logger.info(
    `${LOG_PREFIX} Sync complete for ${dateStr} — pulled=${result.pulled}, upserted=${result.upserted}, skipped=${result.skipped}, errors=${result.errors}`,
  );

  return result;
}
