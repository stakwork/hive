import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { PromptSyncStatus, type Prompt, type PromptVersion } from "@prisma/client";
import { logger } from "@/lib/logger";

export class PromptNotFoundError extends Error {
  constructor(public readonly promptName: string) {
    super(`Prompt "${promptName}" not found`);
    this.name = "PromptNotFoundError";
  }
}

export class PromptNameInvalidError extends Error {
  constructor(public readonly name: string) {
    super(`Prompt name "${name}" must match ^[A-Z0-9_]+$`);
    this.name = "PromptNameInvalidError";
  }
}

export class PromptConflictError extends Error {
  constructor(public readonly name: string) {
    super(`Prompt "${name}" already exists in this workspace`);
    this.name = "PromptConflictError";
  }
}

const PROMPT_NAME_REGEX = /^[A-Z0-9_]+$/;

export type PromptWithVersions = Prompt & {
  versions: PromptVersion[];
  publishedVersion: PromptVersion | null;
};

// ─── token helper ────────────────────────────────────────────────────────────

async function getStakworkToken(workspaceId: string): Promise<string> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { stakworkApiKey: true },
  });

  if (workspace?.stakworkApiKey) {
    try {
      const decrypted = EncryptionService.getInstance().decryptField(
        "stakworkApiKey",
        workspace.stakworkApiKey,
      );
      return decrypted;
    } catch {
      // fall through to global key
    }
  }

  return config.STAKWORK_API_KEY ?? "";
}

/**
 * Returns the workspace-specific Stakwork token only — no global fallback.
 * Used for bulk seeding: we only seed if the workspace has its own token
 * (seeding with a global admin key would import prompts that don't belong
 * to this workspace's customer scope).
 */
async function getWorkspaceOwnToken(workspaceId: string): Promise<string | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { stakworkApiKey: true },
  });

  if (workspace?.stakworkApiKey) {
    try {
      return EncryptionService.getInstance().decryptField(
        "stakworkApiKey",
        workspace.stakworkApiKey,
      );
    } catch {
      return null;
    }
  }

  return null;
}

function stakworkHeaders(token: string) {
  return {
    Authorization: `Token token=${token}`,
    "Content-Type": "application/json",
  };
}

// ─── read-through ─────────────────────────────────────────────────────────────

/**
 * Returns the Hive-local prompt. On a miss, fetches from Stakwork, persists
 * the published value as canonical Hive v1, and returns the new record.
 * Local-wins: once the record exists in Hive it is never re-pulled.
 */
export async function getPromptReadThrough(
  name: string,
  workspaceId: string,
): Promise<PromptWithVersions> {
  // 1. Hive hit
  const existing = await db.prompt.findUnique({
    where: { workspaceId_name: { workspaceId, name } },
    include: { versions: { orderBy: { versionNumber: "asc" } }, publishedVersion: true },
  });
  if (existing) return existing;

  // 2. Stakwork miss — fetch
  const token = await getStakworkToken(workspaceId);
  const baseUrl = config.STAKWORK_BASE_URL ?? "https://api.stakwork.com/api/v1";

  // Search by name
  let listRes: Response;
  try {
    listRes = await fetch(`${baseUrl}/prompts?name=${encodeURIComponent(name)}`, {
      headers: stakworkHeaders(token),
    });
  } catch (err) {
    logger.error("[prompt-sync] network error fetching Stakwork prompt list", "prompt-sync", { name, workspaceId });
    throw err;
  }

  if (listRes.status === 404 || !listRes.ok) {
    throw new PromptNotFoundError(name);
  }

  const listJson = await listRes.json();
  // Stakwork returns { success, data: { prompts: [...] } } or { success, data: [...]  }
  const prompts: Array<{ id: number; name: string }> =
    listJson?.data?.prompts ?? listJson?.data ?? [];
  const match = prompts.find((p) => p.name === name);
  if (!match) throw new PromptNotFoundError(name);

  const stakworkId = match.id;

  // Fetch detail
  let detailRes: Response;
  try {
    detailRes = await fetch(`${baseUrl}/prompts/${stakworkId}`, {
      headers: stakworkHeaders(token),
    });
  } catch (err) {
    logger.error("[prompt-sync] network error fetching Stakwork prompt detail", "prompt-sync", { name, workspaceId, stakworkId });
    throw err;
  }

  if (!detailRes.ok) throw new PromptNotFoundError(name);

  const detailJson = await detailRes.json();
  const data = detailJson?.data ?? detailJson;

  const value: string = data.value ?? "";
  const description: string | undefined = data.description || undefined;

  // Persist in one transaction
  const created = await db.$transaction(async (tx) => {
    const prompt = await tx.prompt.create({
      data: {
        name,
        value,
        description,
        workspaceId,
        stakworkId,
        syncStatus: PromptSyncStatus.OK,
        lastSyncedAt: new Date(),
      },
    });
    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionNumber: 1,
        value,
        description,
        published: true,
        whodunnit: "stakwork-import",
      },
    });
    const updated = await tx.prompt.update({
      where: { id: prompt.id },
      data: { publishedVersionId: version.id },
      include: { versions: true, publishedVersion: true },
    });
    return updated;
  });

  logger.info(
    `[prompt-sync] cache miss — seeded from Stakwork: name=${name} workspaceId=${workspaceId} stakworkId=${stakworkId}`,
    "prompt-sync",
  );

  return created;
}

// ─── bulk workspace seed ─────────────────────────────────────────────────────

interface StakworkSlimPrompt {
  id: number;
  name: string;
  description?: string;
}

interface StakworkDetailData {
  id: number;
  name: string;
  value: string;
  description?: string;
  published_version_id?: string;
}

async function fetchStakworkPromptPage(
  baseUrl: string,
  token: string,
  page: number,
): Promise<{ prompts: StakworkSlimPrompt[]; total: number; size: number }> {
  const res = await fetch(`${baseUrl}/prompts?page=${page}`, {
    headers: stakworkHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Stakwork /prompts?page=${page} returned ${res.status}`);
  }
  const json = await res.json();
  const data = json?.data ?? {};
  return {
    prompts: (data.prompts ?? []) as StakworkSlimPrompt[],
    total: Number(data.total ?? 0),
    size: Number(data.size ?? (data.prompts?.length ?? 0)),
  };
}

async function fetchStakworkPromptDetail(
  baseUrl: string,
  token: string,
  stakworkId: number,
): Promise<StakworkDetailData | null> {
  try {
    const res = await fetch(`${baseUrl}/prompts/${stakworkId}`, {
      headers: stakworkHeaders(token),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? json) as StakworkDetailData;
  } catch {
    return null;
  }
}

async function persistSeededPrompt(
  name: string,
  value: string,
  description: string | undefined,
  stakworkId: number,
  workspaceId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const prompt = await tx.prompt.create({
      data: {
        name,
        value,
        description,
        workspaceId,
        stakworkId,
        syncStatus: PromptSyncStatus.OK,
        lastSyncedAt: new Date(),
      },
    });
    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionNumber: 1,
        value,
        description,
        published: true,
        whodunnit: "stakwork-import",
      },
    });
    await tx.prompt.update({
      where: { id: prompt.id },
      data: { publishedVersionId: version.id },
    });
  });
}

/**
 * Bulk-seeds all Stakwork prompts (customer-scoped + globals) into Hive for
 * the given workspace. Respects local-wins: names already present in Hive are
 * never overwritten. Stamps `promptsSyncedAt` on the workspace when done so
 * this is only triggered once per workspace.
 *
 * If the workspace has no Stakwork token, this is a no-op (does not throw).
 */
export async function seedWorkspacePromptsFromStakwork(
  workspaceId: string,
): Promise<void> {
  const token = await getWorkspaceOwnToken(workspaceId);
  if (!token) {
    // No workspace-specific token — stamp the marker so we don't retry on every list call
    await db.workspace.update({
      where: { id: workspaceId },
      data: { promptsSyncedAt: new Date() },
    });
    return;
  }

  const baseUrl = config.STAKWORK_BASE_URL ?? "https://api.stakwork.com/api/v1";
  const PAGE_SIZE = 20;
  let page = 1;
  let seeded = 0;

  try {
    while (true) {
      const { prompts, total, size } = await fetchStakworkPromptPage(baseUrl, token, page);

      for (const slim of prompts) {
        if (!slim.name || !/^[A-Z0-9_]+$/.test(slim.name)) {
          // Skip prompts whose names don't meet the Hive format requirement
          continue;
        }

        // Local-wins: skip if already in Hive
        const existing = await db.prompt.findUnique({
          where: { workspaceId_name: { workspaceId, name: slim.name } },
          select: { id: true },
        });
        if (existing) continue;

        // N+1 detail fetch
        const detail = await fetchStakworkPromptDetail(baseUrl, token, slim.id);
        if (!detail?.value) continue;

        try {
          await persistSeededPrompt(
            slim.name,
            detail.value,
            detail.description || undefined,
            slim.id,
            workspaceId,
          );
          seeded++;
        } catch (err) {
          // Unique-constraint race: another process seeded it — skip
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("Unique constraint")) {
            logger.warn(
              `[prompt-sync] seed skipped: name=${slim.name} workspaceId=${workspaceId}`,
              "prompt-sync",
              { error: msg },
            );
          }
        }
      }

      // Pagy: no page field in response — loop while page returned full SIZE
      if (size < PAGE_SIZE || page * PAGE_SIZE >= total) break;
      page++;
    }
  } catch (err) {
    logger.error(
      `[prompt-sync] bulk seed failed at page=${page} workspaceId=${workspaceId}`,
      "prompt-sync",
      { error: err instanceof Error ? err.message : String(err) },
    );
    // Don't stamp promptsSyncedAt — let the next call retry
    return;
  }

  // Stamp workspace so we never re-run bulk seed for this workspace
  await db.workspace.update({
    where: { id: workspaceId },
    data: { promptsSyncedAt: new Date() },
  });

  if (seeded > 0) {
    logger.info(
      `[prompt-sync] bulk seed complete: workspaceId=${workspaceId} seeded=${seeded}`,
      "prompt-sync",
    );
  }
}

// ─── write-through ────────────────────────────────────────────────────────────

interface WritePromptThroughParams {
  promptId?: string;
  name: string;
  value: string;
  description?: string;
  workspaceId: string;
  userId: string;
}

/**
 * Create or update a prompt. Hive write always succeeds; Stakwork push is
 * best-effort (failure marks syncStatus=PENDING but does NOT throw).
 */
export async function writePromptThrough(
  params: WritePromptThroughParams,
): Promise<PromptWithVersions> {
  const { promptId, name, value, description, workspaceId, userId } = params;

  // Validate name format
  if (!PROMPT_NAME_REGEX.test(name)) {
    throw new PromptNameInvalidError(name);
  }

  let result: PromptWithVersions;

  if (promptId) {
    // ── UPDATE existing ──────────────────────────────────────────────────────
    // IDOR: verify the prompt belongs to the declared workspace before any write
    const owned = await db.prompt.findFirst({
      where: { id: promptId, workspaceId },
      select: { id: true },
    });
    if (!owned) {
      throw Object.assign(new Error("Prompt not found"), { code: "NOT_FOUND" });
    }

    result = await db.$transaction(async (tx) => {
      // Find max version
      const agg = await tx.promptVersion.aggregate({
        where: { promptId },
        _max: { versionNumber: true },
      });
      const nextVersionNumber = (agg._max.versionNumber ?? 0) + 1;

      // Unpublish all existing versions
      await tx.promptVersion.updateMany({
        where: { promptId },
        data: { published: false },
      });

      // Create new published version
      const newVersion = await tx.promptVersion.create({
        data: {
          promptId,
          versionNumber: nextVersionNumber,
          value,
          description,
          published: true,
          whodunnit: userId,
        },
      });

      // Update Prompt to mirror published version
      return tx.prompt.update({
        where: { id: promptId },
        data: {
          value,
          description,
          publishedVersionId: newVersion.id,
        },
        include: { versions: { orderBy: { versionNumber: "asc" } }, publishedVersion: true },
      });
    });
  } else {
    // ── CREATE new ───────────────────────────────────────────────────────────
    // Check for unique conflict
    const existing = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (existing) throw new PromptConflictError(name);

    result = await db.$transaction(async (tx) => {
      const prompt = await tx.prompt.create({
        data: { name, value, description, workspaceId, syncStatus: PromptSyncStatus.OK },
      });
      const version = await tx.promptVersion.create({
        data: {
          promptId: prompt.id,
          versionNumber: 1,
          value,
          description,
          published: true,
          whodunnit: userId,
        },
      });
      return tx.prompt.update({
        where: { id: prompt.id },
        data: { publishedVersionId: version.id },
        include: { versions: { orderBy: { versionNumber: "asc" } }, publishedVersion: true },
      });
    });
  }

  // Best-effort Stakwork push
  await pushToStakwork(result, value, description, workspaceId);

  return result;
}

// ─── publish version ──────────────────────────────────────────────────────────

/**
 * Promote any historical version to live. IDOR: caller must have verified
 * workspaceId membership BEFORE calling this.
 */
export async function publishVersion(
  promptId: string,
  versionId: string,
  workspaceId: string,
): Promise<PromptWithVersions> {
  // IDOR: verify prompt belongs to workspace
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    select: { id: true, workspaceId: true, stakworkId: true },
  });
  if (!prompt || prompt.workspaceId !== workspaceId) {
    throw Object.assign(new Error("Prompt not found"), { code: "NOT_FOUND" });
  }

  // Verify version belongs to prompt
  const version = await db.promptVersion.findFirst({
    where: { id: versionId, promptId },
  });
  if (!version) {
    throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  }

  // Atomic publish
  const updated = await db.$transaction(async (tx) => {
    await tx.promptVersion.updateMany({
      where: { promptId },
      data: { published: false },
    });
    await tx.promptVersion.update({
      where: { id: versionId },
      data: { published: true },
    });
    return tx.prompt.update({
      where: { id: promptId },
      data: { value: version.value, publishedVersionId: versionId },
      include: { versions: { orderBy: { versionNumber: "asc" } }, publishedVersion: true },
    });
  });

  // Best-effort Stakwork publish
  if (prompt.stakworkId) {
    try {
      const token = await getStakworkToken(workspaceId);
      const baseUrl = config.STAKWORK_BASE_URL ?? "https://api.stakwork.com/api/v1";
      // We don't have a Stakwork versionId here — push the value via update
      await fetch(`${baseUrl}/prompts/${prompt.stakworkId}`, {
        method: "PUT",
        headers: stakworkHeaders(token),
        body: JSON.stringify({ value: version.value }),
      });
    } catch (err) {
      logger.error(
        `[prompt-sync] publish write-through failed: promptId=${promptId} versionId=${versionId}`,
        "prompt-sync",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  return updated;
}

// ─── internal helpers ─────────────────────────────────────────────────────────

async function pushToStakwork(
  prompt: PromptWithVersions,
  value: string,
  description: string | undefined,
  workspaceId: string,
): Promise<void> {
  const token = await getStakworkToken(workspaceId);
  if (!token) {
    logger.warn(
      `[prompt-sync] no Stakwork token — skipping write-through: name=${prompt.name} workspaceId=${workspaceId}`,
      "prompt-sync",
    );
    await db.prompt.update({
      where: { id: prompt.id },
      data: { syncStatus: PromptSyncStatus.PENDING },
    });
    return;
  }

  const baseUrl = config.STAKWORK_BASE_URL ?? "https://api.stakwork.com/api/v1";

  try {
    let res: Response;
    let newStakworkId: number | undefined;

    if (prompt.stakworkId) {
      res = await fetch(`${baseUrl}/prompts/${prompt.stakworkId}`, {
        method: "PUT",
        headers: stakworkHeaders(token),
        body: JSON.stringify({ value, description: description ?? "" }),
      });
    } else {
      res = await fetch(`${baseUrl}/prompts`, {
        method: "POST",
        headers: stakworkHeaders(token),
        body: JSON.stringify({ name: prompt.name, value, description: description ?? "" }),
      });
      if (res.ok) {
        const json = await res.json();
        newStakworkId = json?.data?.id ?? json?.id;
      }
    }

    if (res.ok) {
      await db.prompt.update({
        where: { id: prompt.id },
        data: {
          syncStatus: PromptSyncStatus.OK,
          lastSyncedAt: new Date(),
          ...(newStakworkId ? { stakworkId: newStakworkId } : {}),
        },
      });
    } else {
      const text = await res.text().catch(() => "");
      throw new Error(`Stakwork responded ${res.status}: ${text}`);
    }
  } catch (err) {
    logger.error(
      `[prompt-sync] write-through failed: name=${prompt.name} stakworkId=${prompt.stakworkId}`,
      "prompt-sync",
      { error: err instanceof Error ? err.message : String(err) },
    );
    await db.prompt.update({
      where: { id: prompt.id },
      data: { syncStatus: PromptSyncStatus.PENDING },
    });
    // Do NOT throw — local write already succeeded
  }
}
