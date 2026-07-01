/**
 * Prompt sync service — Hive is the source of truth.
 * All writes commit to Hive first (always succeed), then push best-effort to Stakwork.
 * A Stakwork outage never fails a local write; syncStatus becomes PENDING instead.
 */
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { logger } from "@/lib/logger";
import { stakworkService } from "@/lib/service-factory";
import { Prisma } from "@prisma/client";

const PROMPT_NAME_REGEX = /^[A-Z0-9_]+$/;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WritePromptThroughParams {
  promptId?: string; // undefined = create, defined = update
  name: string;
  value: string;
  description?: string;
  userId: string;
}

export interface WritePromptThroughResult {
  prompt: {
    id: string;
    name: string;
    value: string;
    description: string | null;
    publishedVersionId: string | null;
    stakworkId: number | null;
    syncStatus: string;
    createdAt: Date;
    updatedAt: Date;
  };
  version: {
    id: string;
    versionNumber: number;
    value: string;
    published: boolean;
    createdAt: Date;
  };
}

// ─── Stakwork API helpers ─────────────────────────────────────────────────────

function stakworkHeaders(): Record<string, string> {
  return {
    Authorization: `Token token=${config.STAKWORK_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function pushCreateToStakwork(
  name: string,
  value: string,
  description: string | undefined,
  hiveVersionId: string,
): Promise<number | null> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/`;
  const body = JSON.stringify({
    prompt: { name, value, description: description ?? "" },
    hive_version_id: hiveVersionId,
  });
  const response = await fetch(url, { method: "POST", headers: stakworkHeaders(), body });
  if (!response.ok) {
    throw new Error(`Stakwork POST /prompts/ failed: ${response.status}`);
  }
  const json = await response.json();
  // Stakwork returns the created prompt with a numeric id
  return json?.data?.id ?? null;
}

async function pushUpdateToStakwork(
  stakworkId: number,
  name: string,
  value: string,
  description: string | undefined,
  hiveVersionId: string,
): Promise<void> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/${stakworkId}`;
  const body = JSON.stringify({
    prompt: { name, value, description: description ?? "" },
    hive_version_id: hiveVersionId,
  });
  const response = await fetch(url, { method: "PUT", headers: stakworkHeaders(), body });
  if (!response.ok) {
    throw new Error(`Stakwork PUT /prompts/${stakworkId} failed: ${response.status}`);
  }
}

async function pushDeleteToStakwork(stakworkId: number): Promise<void> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/${stakworkId}`;
  const response = await fetch(url, { method: "DELETE", headers: stakworkHeaders() });
  if (!response.ok) {
    throw new Error(`Stakwork DELETE /prompts/${stakworkId} failed: ${response.status}`);
  }
}

async function pushPublishToStakwork(stakworkId: number, hiveVersionId: string): Promise<void> {
  // Stakwork doesn't have a separate publish API per se, so we send an update
  // carrying the hive_version_id so Stakwork can track which version is live.
  // If the endpoint doesn't exist this is a no-op best-effort.
  const url = `${config.STAKWORK_BASE_URL}/prompts/${stakworkId}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: stakworkHeaders(),
    body: JSON.stringify({ hive_version_id: hiveVersionId }),
  });
  if (!response.ok) {
    throw new Error(`Stakwork PUT /prompts/${stakworkId} (publish) failed: ${response.status}`);
  }
}

// ─── Graph recorder ───────────────────────────────────────────────────────────

/**
 * Best-effort: fire Stakwork workflow to record the prompt version in the knowledge graph.
 * Never throws — a failure here must never affect the caller.
 */
async function recordPromptOnGraph(
  params: {
    prompt: { id: string; name: string; description: string | null; createdAt: Date };
    versionId: string;
    value: string;
  },
  trigger: "create" | "update" | "publish",
): Promise<void> {
  const { prompt, versionId, value } = params;
  const promptId = prompt.id;
  const promptName = prompt.name;

  if (!config.WORKFLOW_GRAPH_PROMPT_STORAGE_ID) {
    logger.warn(
      "[prompt-sync] Prompt graph recorder skipped — WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set",
      "prompt-sync",
      { promptId, promptName, versionId, trigger },
    );
    return;
  }

  try {
    await stakworkService().stakworkRequest("/projects", {
      name: `Prompt Graph Recorder ${prompt.id}`,
      workflow_id: Number(config.WORKFLOW_GRAPH_PROMPT_STORAGE_ID),
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              prompt: {
                id: prompt.id,
                prompt_id: prompt.id,
                prompt_version_id: versionId,
                name: prompt.name,
                description: prompt.description ?? "",
                value,
                published_at: prompt.createdAt,
                customer_id: null,
              },
            },
          },
        },
      },
    });
    logger.info("[prompt-sync] Prompt graph recorder launched", "prompt-sync", {
      promptId,
      promptName,
      versionId,
      trigger,
    });
  } catch (err) {
    logger.warn("[prompt-sync] Prompt graph recorder launch failed (non-fatal)", "prompt-sync", {
      promptId,
      promptName,
      versionId,
      trigger,
      error: String(err),
    });
  }
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Create or update a prompt. Hive writes first; Stakwork push is best-effort.
 */
export async function writePromptThrough(
  params: WritePromptThroughParams,
): Promise<WritePromptThroughResult> {
  const { promptId, name, value, description, userId } = params;

  // ── 1. Hive write — one transaction ──────────────────────────────────────
  let prompt: WritePromptThroughResult["prompt"];
  let version: WritePromptThroughResult["version"];

  if (promptId) {
    // UPDATE: create new version, unpublish others, update Prompt.value
    const existing = await db.prompt.findUnique({ where: { id: promptId } });
    if (!existing) {
      throw Object.assign(new Error("Prompt not found"), { status: 404 });
    }

    const maxVersionRow = await db.promptVersion.aggregate({
      where: { promptId },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (maxVersionRow._max.versionNumber ?? 0) + 1;

    const result = await db.$transaction(async (tx) => {
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
          description: description ?? null,
          whodunnit: userId,
          published: true,
        },
      });

      // Update prompt — LIVE = PUBLISHED invariant
      const updatedPrompt = await tx.prompt.update({
        where: { id: promptId },
        data: {
          value,
          description: description ?? existing.description,
          publishedVersionId: newVersion.id,
        },
      });

      return { prompt: updatedPrompt, version: newVersion };
    });

    prompt = result.prompt;
    version = result.version;
  } else {
    // CREATE: validate name, create Prompt + initial version
    if (!PROMPT_NAME_REGEX.test(name)) {
      throw Object.assign(
        new Error("Prompt name must contain only uppercase letters, digits, and underscores"),
        { status: 400 },
      );
    }

    try {
      const result = await db.$transaction(async (tx) => {
        // Create prompt (value placeholder — updated after version creation)
        const newPrompt = await tx.prompt.create({
          data: {
            name,
            value, // will mirror publishedVersion once set
            description: description ?? null,
          },
        });

        // Create initial published version
        const newVersion = await tx.promptVersion.create({
          data: {
            promptId: newPrompt.id,
            versionNumber: 1,
            value,
            description: description ?? null,
            whodunnit: userId,
            published: true,
          },
        });

        // Update prompt to point at published version (LIVE = PUBLISHED)
        const updatedPrompt = await tx.prompt.update({
          where: { id: newPrompt.id },
          data: { publishedVersionId: newVersion.id },
        });

        return { prompt: updatedPrompt, version: newVersion };
      });

      prompt = result.prompt;
      version = result.version;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw Object.assign(new Error("A prompt with that name already exists"), {
          status: 409,
        });
      }
      throw err;
    }
  }

  // ── 2. Best-effort Stakwork push ──────────────────────────────────────────
  try {
    if (promptId && prompt.stakworkId) {
      await pushUpdateToStakwork(
        prompt.stakworkId,
        prompt.name,
        value,
        description,
        version.id,
      );
    } else {
      const returnedStakworkId = await pushCreateToStakwork(
        prompt.name,
        value,
        description,
        version.id,
      );
      if (returnedStakworkId) {
        await db.prompt.update({
          where: { id: prompt.id },
          data: {
            stakworkId: returnedStakworkId,
            syncStatus: "OK",
            lastSyncedAt: new Date(),
          },
        });
        prompt = { ...prompt, stakworkId: returnedStakworkId, syncStatus: "OK" };
      } else {
        await db.prompt.update({
          where: { id: prompt.id },
          data: { syncStatus: "OK", lastSyncedAt: new Date() },
        });
        prompt = { ...prompt, syncStatus: "OK" };
      }
    }

    if (promptId) {
      await db.prompt.update({
        where: { id: prompt.id },
        data: { syncStatus: "OK", lastSyncedAt: new Date() },
      });
      prompt = { ...prompt, syncStatus: "OK" };
    }

    logger.info("[prompt-sync] Stakwork push succeeded", "prompt-sync", {
      promptName: prompt.name,
      stakworkId: prompt.stakworkId,
      hiveVersionId: version.id,
    });
  } catch (syncErr) {
    logger.warn("[prompt-sync] Stakwork push failed — local write succeeded, marking PENDING", "prompt-sync", {
      promptName: prompt.name,
      stakworkId: prompt.stakworkId,
      hiveVersionId: version.id,
      error: String(syncErr),
    });
    await db.prompt.update({
      where: { id: prompt.id },
      data: { syncStatus: "PENDING" },
    });
    prompt = { ...prompt, syncStatus: "PENDING" };
  }

  // ── 3. Best-effort graph recorder ────────────────────────────────────────
  await recordPromptOnGraph(
    { prompt, versionId: version.id, value },
    promptId ? "update" : "create",
  );

  return { prompt, version };
}

/**
 * Publish a specific version as the live version for a prompt.
 * In ONE transaction: unpublish all, mark target published, update Prompt.value.
 */
export async function publishVersion(
  promptId: string,
  versionId: string,
): Promise<void> {
  // Fetch version to ensure it exists and belongs to the prompt
  const targetVersion = await db.promptVersion.findFirst({
    where: { id: versionId, promptId },
  });
  if (!targetVersion) {
    throw Object.assign(new Error("Version not found"), { status: 404 });
  }

  const prompt = await db.prompt.findUnique({ where: { id: promptId } });
  if (!prompt) {
    throw Object.assign(new Error("Prompt not found"), { status: 404 });
  }

  await db.$transaction([
    db.promptVersion.updateMany({
      where: { promptId },
      data: { published: false },
    }),
    db.promptVersion.update({
      where: { id: versionId },
      data: { published: true },
    }),
    db.prompt.update({
      where: { id: promptId },
      data: {
        value: targetVersion.value,
        publishedVersionId: versionId,
      },
    }),
  ]);

  logger.info("[prompt-sync] Version published", "prompt-sync", {
    promptId,
    versionId,
    versionNumber: targetVersion.versionNumber,
  });

  // Best-effort graph recorder (independent of Stakwork /prompts push)
  await recordPromptOnGraph(
    { prompt, versionId, value: targetVersion.value },
    "publish",
  );

  // Best-effort Stakwork push
  if (prompt.stakworkId) {
    try {
      await pushPublishToStakwork(prompt.stakworkId, versionId);
      logger.info("[prompt-sync] Stakwork publish push succeeded", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
        hiveVersionId: versionId,
      });
    } catch (syncErr) {
      logger.warn("[prompt-sync] Stakwork publish push failed (non-fatal)", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
        hiveVersionId: versionId,
        error: String(syncErr),
      });
    }
  }
}

/**
 * Delete a prompt from Hive (cascades to versions); best-effort DELETE to Stakwork.
 */
export async function deletePrompt(promptId: string): Promise<void> {
  const prompt = await db.prompt.findUnique({ where: { id: promptId } });
  if (!prompt) {
    throw Object.assign(new Error("Prompt not found"), { status: 404 });
  }

  await db.prompt.delete({ where: { id: promptId } });

  if (prompt.stakworkId) {
    try {
      await pushDeleteToStakwork(prompt.stakworkId);
      logger.info("[prompt-sync] Stakwork delete succeeded", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
      });
    } catch (syncErr) {
      logger.warn("[prompt-sync] Stakwork delete failed (non-fatal)", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
        error: String(syncErr),
      });
    }
  }
}
