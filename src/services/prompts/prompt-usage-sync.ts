import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StakworkPromptUsageRow {
  id: number;
  prompt_id: number | null;
  prompt_name: string;
  workflow_id: number;
  workflow_name: string | null;
  step_id: string;
  step_unique_id: string | null;
  field_path: string | null;
  created_at: string;
  updated_at: string;
}

interface PromptUsagePage {
  total: number;
  size: number;
  prompt_usages: StakworkPromptUsageRow[];
}

export interface PromptUsageSyncResult {
  success: boolean;
  /** Always 0 for the global run; kept for backward compatibility with the cron route. */
  workspacesProcessed: number;
  usagesUpserted: number;
  usagesPruned: number;
  /** "global" indicates a single environment-key pull; future per-workspace runs could set "per-workspace". */
  scope: "global" | "per-workspace";
  errors: Array<{ workspaceSlug: string; error: string }>;
  timestamp: Date;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch a single page of prompt usages from Stakwork.
 * Throws on non-OK response (caller catches and handles gracefully).
 */
export async function fetchPromptUsagePage(token: string, page: number): Promise<PromptUsagePage> {
  const url = `${config.STAKWORK_BASE_URL}/prompt_usages?page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Token token="${token}"`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Stakwork prompt_usages fetch failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.data as PromptUsagePage;
}

// ── Shared pagination helper ──────────────────────────────────────────────────

/**
 * Page through all Stakwork prompt usages for the given token,
 * returning the accumulated rows.
 */
async function fetchAllPromptUsageRows(
  token: string,
  logPrefix: string,
): Promise<StakworkPromptUsageRow[]> {
  const allRows: StakworkPromptUsageRow[] = [];
  let page = 1;
  let total: number | null = null;

  while (true) {
    const data = await fetchPromptUsagePage(token, page);

    if (total === null) {
      total = data.total;
      logger.info(`${logPrefix} total=${total}`);
    }

    allRows.push(...data.prompt_usages);
    logger.info(`${logPrefix} fetched page ${page}, accumulated ${allRows.length}/${total}`);

    if (allRows.length >= total) break;
    page++;
  }

  return allRows;
}

// ── Global sync ───────────────────────────────────────────────────────────────

/**
 * Sync prompt usages using a single global pull authenticated with the
 * environment-level Stakwork key. Rows are stored with `workspaceId = null`.
 *
 * Why lookup-based upsert instead of `db.promptUsage.upsert` with the
 * composite unique constraint?
 * Postgres treats NULL != NULL in unique index comparisons, so the existing
 * `@@unique([workspaceId, workflowId, stepId, promptName])` will NOT deduplicate
 * rows where workspaceId is NULL. The partial unique index
 * `prompt_usages_global_unique` guards concurrent races at the DB level,
 * but within a single sync run we use a findFirst+update/create pattern
 * to avoid duplicate-key errors and stay consistent with Prisma idioms.
 */
export async function syncPromptUsagesGlobal(token: string): Promise<{ upserted: number; pruned: number }> {
  logger.info("[prompt-sync] Starting global prompt usage pull");

  const allRows = await fetchAllPromptUsageRows(token, "[prompt-sync][global]");

  // Resolve promptId by name
  const uniqueNames = [...new Set(allRows.map((r) => r.prompt_name))];
  const matchingPrompts = await db.prompt.findMany({
    where: { name: { in: uniqueNames } },
    select: { id: true, name: true },
  });
  const nameToId = new Map(matchingPrompts.map((p) => [p.name, p.id]));

  // Lookup-based upsert for null-workspace rows
  let upserted = 0;
  for (const row of allRows) {
    const promptId = nameToId.get(row.prompt_name) ?? null;

    const existing = await db.promptUsage.findFirst({
      where: {
        workspaceId: null,
        workflowId: row.workflow_id,
        stepId: row.step_id,
        promptName: row.prompt_name,
      },
      select: { id: true },
    });

    if (existing) {
      await db.promptUsage.update({
        where: { id: existing.id },
        data: {
          promptId,
          workflowName: row.workflow_name ?? null,
          stepUniqueId: row.step_unique_id ?? null,
          fieldPath: row.field_path ?? null,
        },
      });
    } else {
      await db.promptUsage.create({
        data: {
          workspaceId: null,
          promptId,
          promptName: row.prompt_name,
          workflowId: row.workflow_id,
          workflowName: row.workflow_name ?? null,
          stepId: row.step_id,
          stepUniqueId: row.step_unique_id ?? null,
          fieldPath: row.field_path ?? null,
        },
      });
    }
    upserted++;
  }

  // Prune global rows no longer present upstream
  const freshKeys = allRows.map((r) => ({
    workflowId: r.workflow_id,
    stepId: r.step_id,
    promptName: r.prompt_name,
  }));

  const { count: pruned } = await db.promptUsage.deleteMany({
    where: {
      workspaceId: null,
      NOT: freshKeys.map((k) => ({
        workflowId: k.workflowId,
        stepId: k.stepId,
        promptName: k.promptName,
      })),
    },
  });

  logger.info(`[prompt-sync][global] upserted=${upserted}, pruned=${pruned}`);
  return { upserted, pruned };
}

// ── Per-workspace sync ────────────────────────────────────────────────────────

/**
 * Sync prompt usages for a single workspace, given a pre-resolved auth token.
 * Rows are stored scoped to the workspace (workspaceId = workspace.id).
 */
export async function syncPromptUsagesForWorkspace(
  workspace: { id: string; slug: string },
  token: string,
): Promise<{ upserted: number; pruned: number }> {
  logger.info(`[prompt-sync] Starting prompt usage pull for workspace ${workspace.slug}`);

  const allRows = await fetchAllPromptUsageRows(token, `[prompt-sync][${workspace.slug}]`);

  // Resolve promptId by name for each row
  const uniqueNames = [...new Set(allRows.map((r) => r.prompt_name))];
  const matchingPrompts = await db.prompt.findMany({
    where: { name: { in: uniqueNames } },
    select: { id: true, name: true },
  });
  const nameToId = new Map(matchingPrompts.map((p) => [p.name, p.id]));

  // Upsert each row using the composite unique constraint (workspaceId is non-null here)
  let upserted = 0;
  for (const row of allRows) {
    const promptId = nameToId.get(row.prompt_name) ?? null;
    await db.promptUsage.upsert({
      where: {
        workspaceId_workflowId_stepId_promptName: {
          workspaceId: workspace.id,
          workflowId: row.workflow_id,
          stepId: row.step_id,
          promptName: row.prompt_name,
        },
      },
      create: {
        workspaceId: workspace.id,
        promptId,
        promptName: row.prompt_name,
        workflowId: row.workflow_id,
        workflowName: row.workflow_name ?? null,
        stepId: row.step_id,
        stepUniqueId: row.step_unique_id ?? null,
        fieldPath: row.field_path ?? null,
      },
      update: {
        promptId,
        workflowName: row.workflow_name ?? null,
        stepUniqueId: row.step_unique_id ?? null,
        fieldPath: row.field_path ?? null,
      },
    });
    upserted++;
  }

  // Prune rows no longer in upstream for this workspace
  const freshKeys = allRows.map((r) => ({
    workflowId: r.workflow_id,
    stepId: r.step_id,
    promptName: r.prompt_name,
  }));

  const { count: pruned } = await db.promptUsage.deleteMany({
    where: {
      workspaceId: workspace.id,
      NOT: freshKeys.map((k) => ({
        workflowId: k.workflowId,
        stepId: k.stepId,
        promptName: k.promptName,
      })),
    },
  });

  logger.info(`[prompt-sync] workspace ${workspace.slug}: upserted=${upserted}, pruned=${pruned}`);
  return { upserted, pruned };
}

/**
 * Per-workspace helper that decrypts the workspace's stakworkApiKey and
 * delegates to `syncPromptUsagesForWorkspace`. Kept fully functional for
 * future per-workspace use; not called by the scheduled cron by default.
 */
export async function syncPromptUsagesForWorkspaceWithDecryptedKey(workspace: {
  id: string;
  slug: string;
  stakworkApiKey: string | null;
}): Promise<{ upserted: number; pruned: number }> {
  const encryptionService = EncryptionService.getInstance();

  if (!workspace.stakworkApiKey) {
    logger.info(`[prompt-sync] Skipping workspace ${workspace.slug}: no stakworkApiKey`);
    return { upserted: 0, pruned: 0 };
  }

  let token: string;
  try {
    token = encryptionService.decryptField("stakworkApiKey", workspace.stakworkApiKey);
    if (!token || token.trim().length === 0) {
      logger.info(`[prompt-sync] Skipping workspace ${workspace.slug}: empty token after decrypt`);
      return { upserted: 0, pruned: 0 };
    }
  } catch (err) {
    logger.warn(
      `[prompt-sync] Skipping workspace ${workspace.slug}: decrypt failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { upserted: 0, pruned: 0 };
  }

  return syncPromptUsagesForWorkspace(workspace, token);
}

// ── Scheduled execution ───────────────────────────────────────────────────────

/**
 * Execute the scheduled prompt usage sync via a single global pull using
 * the environment-level STAKWORK_API_KEY. This replaces the prior per-workspace
 * loop as the cron default driver.
 *
 * The per-workspace path remains available via `syncPromptUsagesForWorkspaceWithDecryptedKey`.
 */
export async function executeScheduledPromptUsageSync(): Promise<PromptUsageSyncResult> {
  const result: PromptUsageSyncResult = {
    success: true,
    workspacesProcessed: 0, // Always 0 for a global run; kept for backward compat
    usagesUpserted: 0,
    usagesPruned: 0,
    scope: "global",
    errors: [],
    timestamp: new Date(),
  };

  logger.info(`[prompt-sync] Starting scheduled global prompt usage sync at ${result.timestamp.toISOString()}`);

  const apiKey = config.STAKWORK_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    const msg = "STAKWORK_API_KEY is not configured — skipping global prompt usage sync";
    logger.error(`[prompt-sync] ${msg}`);
    result.success = false;
    result.errors.push({ workspaceSlug: "global", error: msg });
    return result;
  }

  try {
    const { upserted, pruned } = await syncPromptUsagesGlobal(apiKey);
    result.usagesUpserted = upserted;
    result.usagesPruned = pruned;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`[prompt-sync] Global sync failed: ${errorMessage}`);
    result.errors.push({ workspaceSlug: "global", error: errorMessage });
    result.success = false;
  }

  logger.info(
    `[prompt-sync] Global sync completed. scope=global, upserted=${result.usagesUpserted}, pruned=${result.usagesPruned}, errors=${result.errors.length}`,
  );

  return result;
}
