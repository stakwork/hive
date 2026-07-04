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
  agentNames?: string[];
  userId: string;
}

export interface WritePromptThroughResult {
  prompt: {
    id: string;
    name: string;
    value: string;
    description: string | null;
    agentNames: string[];
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
    description: string | null;
    published: boolean;
    createdAt: Date;
  };
}

// ─── Stakwork API helpers ─────────────────────────────────────────────────────

export function stakworkHeaders(): Record<string, string> {
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
    prompt: { name, value, description: description ?? "", hive_version_id: hiveVersionId },
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
    prompt: { name, value, description: description ?? "", hive_version_id: hiveVersionId },
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
    body: JSON.stringify({ prompt: { hive_version_id: hiveVersionId } }),
  });
  if (!response.ok) {
    throw new Error(`Stakwork PUT /prompts/${stakworkId} (publish) failed: ${response.status}`);
  }
}

// ─── Graph recorder ───────────────────────────────────────────────────────────

/**
 * Dispatch a Stakwork graph-recorder workflow for the given prompt version.
 * Contains the single-source-of-truth payload shape.
 * Throws on failure — callers decide how to handle errors.
 * No-ops (with a warn log) when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is unset.
 */
export async function sendPromptGraphRequest(
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
}

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
  const { prompt, versionId } = params;
  const promptId = prompt.id;
  const promptName = prompt.name;

  try {
    await sendPromptGraphRequest(params, trigger);
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

// ─── Usage/run-count read helpers (best-effort, never throw) ─────────────────

export interface PromptUsage {
  workflow_id: number;
  workflow_name: string;
  step_id: string;
}

/**
 * Fetch prompt usages from Stakwork and return a name→usages[] map.
 * Best-effort: returns an empty Map on any error/outage.
 */
export async function fetchPromptUsagesByName(): Promise<Map<string, PromptUsage[]>> {
  try {
    const url = `${config.STAKWORK_BASE_URL}/prompts?include_usages=true`;
    const response = await fetch(url, { method: "GET", headers: stakworkHeaders() });
    if (!response.ok) {
      logger.warn(
        `[prompt-sync] fetchPromptUsagesByName: Stakwork returned ${response.status}`,
        "prompt-sync",
        { status: response.status },
      );
      return new Map();
    }
    const json = await response.json();
    const prompts: Array<unknown> = json?.data?.prompts ?? json?.prompts ?? [];
    const map = new Map<string, PromptUsage[]>();
    for (const p of prompts) {
      if (!p || typeof p !== "object") continue;
      const entry = p as { name?: unknown; usages?: unknown };
      if (typeof entry.name === "string" && Array.isArray(entry.usages)) {
        map.set(entry.name, entry.usages as PromptUsage[]);
      }
    }
    return map;
  } catch (err) {
    logger.warn(
      "[prompt-sync] fetchPromptUsagesByName: Stakwork fetch failed (non-fatal)",
      "prompt-sync",
      { error: String(err) },
    );
    return new Map();
  }
}

/**
 * Fetch run count for a specific prompt version from Stakwork.
 * Best-effort: returns null on any error/outage/miss.
 */
export async function fetchVersionRunCount(
  name: string,
  hiveVersionId: string,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ name, hive_version_id: hiveVersionId });
    const url = `${config.STAKWORK_BASE_URL}/prompts/find_by_version?${params}`;
    const response = await fetch(url, { method: "GET", headers: stakworkHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) {
      logger.warn(
        `[prompt-sync] fetchVersionRunCount: Stakwork returned ${response.status}`,
        "prompt-sync",
        { name, hiveVersionId, status: response.status },
      );
      return null;
    }
    const json = await response.json();
    const runCount = json?.run_count ?? json?.data?.run_count;
    return typeof runCount === "number" ? runCount : null;
  } catch (err) {
    logger.warn(
      "[prompt-sync] fetchVersionRunCount: Stakwork fetch failed (non-fatal)",
      "prompt-sync",
      { name, hiveVersionId, error: String(err) },
    );
    return null;
  }
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Create or update a prompt. Hive writes first; Stakwork push is best-effort.
 */
export async function writePromptThrough(
  params: WritePromptThroughParams,
): Promise<WritePromptThroughResult> {
  const { promptId, name, value, description, agentNames, userId } = params;

  // ── 1. Hive write — one transaction ──────────────────────────────────────
  let prompt: WritePromptThroughResult["prompt"];
  let version: WritePromptThroughResult["version"];

  if (promptId) {
    // UPDATE: create a new UNPUBLISHED draft version; leave published pointer and Prompt.value unchanged.
    const existing = await db.prompt.findUnique({ where: { id: promptId } });
    if (!existing) {
      throw Object.assign(new Error("Prompt not found"), { status: 404 });
    }

    try {
      const result = await db.$transaction(async (tx) => {
        // Compute nextVersionNumber inside the transaction to be safe under concurrent saves.
        const maxRow = await tx.promptVersion.aggregate({
          where: { promptId },
          _max: { versionNumber: true },
        });
        const nextVersionNumber = (maxRow._max.versionNumber ?? 0) + 1;

        // Create new UNPUBLISHED draft — leave existing published version intact.
        const newVersion = await tx.promptVersion.create({
          data: {
            promptId,
            versionNumber: nextVersionNumber,
            value,
            description: description ?? null,
            whodunnit: userId,
            published: false,
          },
        });

        // Only bump updatedAt; do NOT touch value/description/publishedVersionId.
        // agentNames is a Prompt-level field (stable across versions) — write it when provided.
        const updatedPrompt = await tx.prompt.update({
          where: { id: promptId },
          data: {
            updatedAt: new Date(),
            ...(agentNames !== undefined && { agentNames }),
          },
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
        throw Object.assign(
          new Error("Concurrent save conflict — please retry"),
          { status: 409 },
        );
      }
      throw err;
    }

    logger.info("[prompt-sync] Created unpublished draft version", "prompt-sync", {
      promptId,
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
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
            agentNames: agentNames ?? [],
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
  // Only fire on CREATE — firing on UPDATE (draft save) would misrepresent
  // an unpublished draft as the live/published snapshot in the knowledge graph.
  // publishVersion() handles the "publish" trigger independently.
  if (!promptId) {
    await recordPromptOnGraph(
      { prompt, versionId: version.id, value },
      "create",
    );
  }

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
