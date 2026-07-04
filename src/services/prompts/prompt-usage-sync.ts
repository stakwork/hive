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
  workspacesProcessed: number;
  usagesUpserted: number;
  usagesPruned: number;
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

// ── Per-workspace sync ────────────────────────────────────────────────────────

/**
 * Sync prompt usages for a single workspace.
 * Returns { upserted, pruned } counts or throws if decryption fails.
 */
export async function syncPromptUsagesForWorkspace(workspace: {
  id: string;
  slug: string;
  stakworkApiKey: string | null;
}): Promise<{ upserted: number; pruned: number }> {
  const encryptionService = EncryptionService.getInstance();

  // Decrypt token — skip workspace if missing or invalid
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
    logger.warn(`[prompt-sync] Skipping workspace ${workspace.slug}: decrypt failed — ${err instanceof Error ? err.message : String(err)}`);
    return { upserted: 0, pruned: 0 };
  }

  logger.info(`[prompt-sync] Starting prompt usage pull for workspace ${workspace.slug}`);

  // Page through all results
  const allRows: StakworkPromptUsageRow[] = [];
  let page = 1;
  let total: number | null = null;

  while (true) {
    const data = await fetchPromptUsagePage(token, page);

    if (total === null) {
      total = data.total;
      logger.info(`[prompt-sync] workspace ${workspace.slug}: total=${total}`);
    }

    allRows.push(...data.prompt_usages);
    logger.info(`[prompt-sync] workspace ${workspace.slug}: fetched page ${page}, accumulated ${allRows.length}/${total}`);

    if (allRows.length >= total) break;
    page++;
  }

  // Resolve promptId by name for each row
  const uniqueNames = [...new Set(allRows.map((r) => r.prompt_name))];
  const matchingPrompts = await db.prompt.findMany({
    where: { name: { in: uniqueNames } },
    select: { id: true, name: true },
  });
  const nameToId = new Map(matchingPrompts.map((p) => [p.name, p.id]));

  // Upsert each row
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

  // Prune rows no longer in upstream
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

// ── Scheduled execution ───────────────────────────────────────────────────────

/**
 * Execute the scheduled prompt usage sync across all eligible workspaces.
 */
export async function executeScheduledPromptUsageSync(): Promise<PromptUsageSyncResult> {
  const result: PromptUsageSyncResult = {
    success: true,
    workspacesProcessed: 0,
    usagesUpserted: 0,
    usagesPruned: 0,
    errors: [],
    timestamp: new Date(),
  };

  logger.info(`[prompt-sync] Starting scheduled prompt usage sync at ${result.timestamp.toISOString()}`);

  const workspaces = await db.workspace.findMany({
    where: { deleted: false, stakworkApiKey: { not: null } },
    select: { id: true, slug: true, stakworkApiKey: true },
  });

  logger.info(`[prompt-sync] Found ${workspaces.length} workspaces with stakworkApiKey`);
  result.workspacesProcessed = workspaces.length;

  for (const workspace of workspaces) {
    try {
      const { upserted, pruned } = await syncPromptUsagesForWorkspace(workspace);
      result.usagesUpserted += upserted;
      result.usagesPruned += pruned;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`[prompt-sync] Error syncing workspace ${workspace.slug}: ${errorMessage}`);
      result.errors.push({ workspaceSlug: workspace.slug, error: errorMessage });
      result.success = false;
    }
  }

  logger.info(
    `[prompt-sync] Sync completed. upserted=${result.usagesUpserted}, pruned=${result.usagesPruned}, errors=${result.errors.length}`,
  );

  return result;
}
