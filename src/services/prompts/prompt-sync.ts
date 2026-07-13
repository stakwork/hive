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
  workspaceId?: string;
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

/**
 * Coerce a candidate value to a positive integer within Postgres 32-bit signed Int range.
 * Accepts a number or numeric string; rejects everything else (returns null).
 */
function coerceStakworkId(candidate: unknown): number | null {
  if (candidate === null || candidate === undefined) return null;
  const n = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) return null;
  return n;
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
  const data = json?.data;

  // ── Structured extraction ───────────────────────────────────────────────
  // Prefer data.prompt.id (Stakwork's forthcoming structured field), then data.id
  // (existing shape — current tests mock { data: { id: 42 } }, must keep passing).
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const fromPrompt = coerceStakworkId((d.prompt as Record<string, unknown> | undefined)?.id);
    if (fromPrompt !== null) return fromPrompt;
    const fromData = coerceStakworkId(d.id);
    if (fromData !== null) return fromData;
  }

  // ── Message-string fallback ─────────────────────────────────────────────
  // Stakwork today returns data as a bare string, e.g. "GONZA_DEMO created with id 2114".
  // Use an anchored trailing pattern so an earlier "hive_version_id N" token cannot match.
  const msg =
    typeof data === "string"
      ? data
      : typeof (data as Record<string, unknown> | null)?.message === "string"
        ? (data as Record<string, unknown>).message as string
        : null;
  if (msg) {
    const match = msg.match(/id (\d+)\s*$/);
    if (match) return coerceStakworkId(match[1]);
  }

  return null;
}

/**
 * Shared PUT helper for both draft-save and publish pushes.
 * Returns `{ alreadyExists: true }` when Stakwork reports the hive_version_id was already
 * synced (e.g. the draft was pushed earlier) — callers treat this as a benign no-op.
 * Throws for all other non-ok responses.
 */
async function pushPromptToStakwork(
  stakworkId: number,
  name: string,
  value: string,
  description: string | undefined,
  hiveVersionId: string,
  published?: boolean,
  operationLabel = "update",
): Promise<{ alreadyExists: boolean }> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/${stakworkId}`;
  const body = JSON.stringify({
    prompt: {
      name,
      value,
      description: description ?? "",
      hive_version_id: hiveVersionId,
      ...(published ? { published: true } : {}),
    },
  });
  const response = await fetch(url, { method: "PUT", headers: stakworkHeaders(), body });
  if (!response.ok) {
    // Stakwork returns a failure when the hive_version_id was already registered (e.g.
    // the draft was synced during writePromptThrough before this publish push fires).
    // Detect that specific case so callers can treat it as a benign no-op success.
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      // ignore — best effort
    }
    if (responseText.toLowerCase().includes("hive_version_id already exists")) {
      return { alreadyExists: true };
    }
    throw new Error(
      `Stakwork PUT /prompts/${stakworkId} (${operationLabel}) failed: ${response.status}`,
    );
  }
  return { alreadyExists: false };
}

async function pushUpdateToStakwork(
  stakworkId: number,
  name: string,
  value: string,
  description: string | undefined,
  hiveVersionId: string,
): Promise<void> {
  await pushPromptToStakwork(stakworkId, name, value, description, hiveVersionId, false, "update");
}

async function pushDeleteToStakwork(stakworkId: number): Promise<void> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/${stakworkId}`;
  const response = await fetch(url, { method: "DELETE", headers: stakworkHeaders() });
  if (!response.ok) {
    throw new Error(`Stakwork DELETE /prompts/${stakworkId} failed: ${response.status}`);
  }
}

async function pushPublishToStakwork(
  stakworkId: number,
  name: string,
  value: string,
  description: string | undefined,
  hiveVersionId: string,
): Promise<{ alreadyExists: boolean }> {
  // Send the full version content so Stakwork's PUT actually rewrites live content.
  // `published: true` is included for forward-compat; the endpoint currently silently drops
  // it but live promotion is achieved by the content payload itself (verified via @stakwork).
  return pushPromptToStakwork(stakworkId, name, value, description, hiveVersionId, true, "publish");
}

// ─── Graph recorder ───────────────────────────────────────────────────────────

/**
 * Dispatch a Stakwork graph-recorder workflow for the given prompt version.
 * Contains the single-source-of-truth payload shape.
 * Throws on failure — callers decide how to handle errors.
 * No-ops (with a warn log) when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is unset or non-numeric.
 */
export async function sendPromptGraphRequest(
  params: {
    prompt: { id: string; name: string; description: string | null; createdAt: Date };
    versionId: string;
    value: string;
    workspaceId?: string;
  },
  trigger: "create" | "update" | "publish",
): Promise<void> {
  const { prompt, versionId, value } = params;
  const promptId = prompt.id;
  const promptName = prompt.name;

  const rawWorkflowId = config.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
  if (!rawWorkflowId || !/^\d+$/.test(rawWorkflowId)) {
    logger.warn(
      "[prompt-sync] Prompt graph recorder skipped — WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set or non-numeric",
      "prompt-sync",
      { promptId, promptName, versionId, trigger, rawWorkflowId },
    );
    return;
  }

  await stakworkService().stakworkRequest("/projects", {
    name: `Prompt Graph Recorder ${prompt.id}`,
    workflow_id: Number(rawWorkflowId),
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
  workspaceId?: string,
): Promise<void> {
  const { prompt, versionId } = params;
  const promptId = prompt.id;
  const promptName = prompt.name;

  try {
    await sendPromptGraphRequest({ ...params, workspaceId }, trigger);
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
  const { promptId, name, value, description, agentNames, userId, workspaceId } = params;

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
        // 2xx but no id captured — leave PENDING so the broken sync is visible/retryable.
        logger.warn(
          "[prompt-sync] Stakwork create returned 2xx but no id could be extracted — marking PENDING",
          "prompt-sync",
          { promptName: prompt.name, hiveVersionId: version.id },
        );
        await db.prompt.update({
          where: { id: prompt.id },
          data: { syncStatus: "PENDING" },
        });
        prompt = { ...prompt, syncStatus: "PENDING" };
      }
    }

    if (promptId) {
      await db.prompt.update({
        where: { id: prompt.id },
        data: { syncStatus: "OK", lastSyncedAt: new Date() },
      });
      prompt = { ...prompt, syncStatus: "OK" };
    }

    // Do not log success when the create resolved to no id (PENDING).
    if (prompt.syncStatus !== "PENDING") {
      logger.info("[prompt-sync] Stakwork push succeeded", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
        hiveVersionId: version.id,
      });
    }
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
      workspaceId,
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
  workspaceId?: string,
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
    workspaceId,
  );

  // Best-effort Stakwork push — full version content so the live prompt is updated.
  if (prompt.stakworkId) {
    try {
      const { alreadyExists } = await pushPublishToStakwork(
        prompt.stakworkId,
        prompt.name,
        targetVersion.value,
        targetVersion.description ?? undefined,
        versionId,
      );

      if (alreadyExists) {
        // The draft-save (writePromptThrough) already synced this hive_version_id to Stakwork.
        // Treat as a benign no-op: the content is already there; just clear any PENDING state.
        logger.info("[prompt-sync] Stakwork publish push — version already synced (no-op success)", "prompt-sync", {
          promptName: prompt.name,
          stakworkId: prompt.stakworkId,
          hiveVersionId: versionId,
        });
      } else {
        logger.info("[prompt-sync] Stakwork publish push succeeded", "prompt-sync", {
          promptName: prompt.name,
          stakworkId: prompt.stakworkId,
          hiveVersionId: versionId,
        });
      }

      // On success (or benign already-exists), clear any previously PENDING state.
      await db.prompt.update({
        where: { id: promptId },
        data: { syncStatus: "OK", lastSyncedAt: new Date() },
      });
    } catch (syncErr) {
      logger.warn("[prompt-sync] Stakwork publish push failed (non-fatal)", "prompt-sync", {
        promptName: prompt.name,
        stakworkId: prompt.stakworkId,
        hiveVersionId: versionId,
        error: String(syncErr),
      });
      // Persist PENDING so a future re-sync can retry — mirrors the create/update failure path.
      await db.prompt.update({
        where: { id: promptId },
        data: { syncStatus: "PENDING" },
      });
    }
  }
}

// ─── Stakwork index lookup & reconciliation helpers ───────────────────────────

const INDEX_PAGE_SIZE = 20;

/**
 * Fetch the full Stakwork prompt index and group entries by exact name.
 * Returns a Map<name, entries[]> — a bucket with more than one entry means
 * Stakwork holds multiple prompts sharing that name (ambiguous; never bind those).
 *
 * Paginates exactly like fetchListPage/seedPrompts in seed-stakwork-prompts.ts:
 *   GET ${STAKWORK_BASE_URL}/prompts?page=N  (config.STAKWORK_BASE_URL already includes /api/v1)
 * Stop when a page returns fewer than INDEX_PAGE_SIZE (20) entries.
 *
 * Auth: tries the quoted form first (proven by fetchListPage against the list endpoint);
 * falls back to the unquoted stakworkHeaders() form on a 401.
 * Honors 429 Retry-After with a short backoff rather than aborting the whole build.
 */
export async function buildStakworkPromptIndexByName(): Promise<
  Map<string, Array<{ id: number; name: string }>>
> {
  const index = new Map<string, Array<{ id: number; name: string }>>();
  const quotedAuth = `Token token="${config.STAKWORK_API_KEY}"`;
  const unquotedAuth = stakworkHeaders().Authorization;

  // Start with the quoted form (proven against the list endpoint by fetchListPage).
  // Falls back to unquoted once on a 401 — and stays with whichever form works.
  let authHeader = quotedAuth;
  let page = 1;

  while (true) {
    const url = `${config.STAKWORK_BASE_URL}/prompts?page=${page}`;
    let response = await fetch(url, {
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
    });

    // On 401 with quoted form, try unquoted once and re-fetch the same page
    if (response.status === 401 && authHeader === quotedAuth) {
      authHeader = unquotedAuth;
      response = await fetch(url, {
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
      });
    }

    // Honor rate-limiting: wait for Retry-After (or a 2-second default) then retry this page
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue; // retry the same page number
    }

    if (!response.ok) {
      throw new Error(
        `Stakwork GET /prompts?page=${page} failed: ${response.status}`,
      );
    }

    const json = await response.json();
    const prompts: Array<{ id: number; name: string }> = json?.data?.prompts ?? [];

    for (const entry of prompts) {
      const bucket = index.get(entry.name) ?? [];
      bucket.push({ id: entry.id, name: entry.name });
      index.set(entry.name, bucket);
    }

    // Pagy: a short page means we've reached the end of the index
    if (prompts.length < INDEX_PAGE_SIZE) {
      break;
    }

    page++;
  }

  return index;
}

/**
 * Fetch a single Stakwork prompt's full detail record.
 * Returns the raw JSON payload so callers can inspect undeclared fields (e.g. hive_version_id).
 * Only logs response.status — never logs the request object or Authorization header.
 */
async function defaultFetchDetail(id: number): Promise<Record<string, unknown>> {
  const url = `${config.STAKWORK_BASE_URL}/prompts/${id}`;
  const response = await fetch(url, {
    headers: {
      // Use quoted form — consistent with the list endpoint auth
      Authorization: `Token token="${config.STAKWORK_API_KEY}"`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Stakwork GET /prompts/${id} failed: ${response.status}`);
  }
  const json = await response.json();
  // Return the inner data object (or root) so callers access fields directly
  return (json?.data ?? json) as Record<string, unknown>;
}

/**
 * Given a Hive prompt and a pre-built Stakwork name index, decide whether (and how) the
 * prompt can be safely relinked to its Stakwork counterpart.
 *
 * Resolution rules:
 *   - No candidates for prompt.name                → { reason: "no-match" }
 *   - More than one candidate (ambiguous names)    → { reason: "ambiguous" }
 *   - Exactly one candidate:
 *       • Fetch its full detail
 *       • If detail contains hive_version_id matching a known Hive version id
 *                                                  → { id, verified: true }
 *       • If detail contains hive_version_id but it doesn't match any known version id
 *                                                  → { reason: "ownership-mismatch" }
 *       • If detail has no hive_version_id at all (field absent)
 *                                                  → { id, verified: false }  (name-based fallback)
 *
 * The `opts.fetchDetail` injectable is used by unit tests to avoid live HTTP calls.
 */
export async function resolveStakworkPromptId(
  prompt: { name: string; versions?: Array<{ id: string }> },
  index: Map<string, Array<{ id: number; name: string }>>,
  opts?: { fetchDetail?: (id: number) => Promise<Record<string, unknown>> },
): Promise<
  | { id: number; verified: boolean }
  | { reason: "no-match" | "ambiguous" | "ownership-mismatch" }
> {
  const candidates = index.get(prompt.name);

  if (!candidates || candidates.length === 0) {
    return { reason: "no-match" };
  }

  if (candidates.length > 1) {
    return { reason: "ambiguous" };
  }

  // Exactly one candidate — verify ownership via detail record
  const candidate = candidates[0];
  const fetchDetailFn = opts?.fetchDetail ?? defaultFetchDetail;

  const detail = await fetchDetailFn(candidate.id);

  // Defensively probe for hive_version_id — the TS StakworkPromptDetail interface
  // doesn't declare it, but the live API may return it; check the raw JSON.
  if ("hive_version_id" in detail && detail.hive_version_id != null) {
    const versionIds = (prompt.versions ?? []).map((v) => v.id);
    if (versionIds.includes(String(detail.hive_version_id))) {
      return { id: candidate.id, verified: true };
    }
    // hive_version_id is present but belongs to a different Hive environment — do not bind
    return { reason: "ownership-mismatch" };
  }

  // No hive_version_id in the detail — fall back to unique name match
  return { id: candidate.id, verified: false };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a prompt from Hive (cascades to versions); best-effort DELETE to Stakwork.
 */
export async function deletePrompt(promptId: string): Promise<void> {
  const prompt = await db.prompt.findUnique({ where: { id: promptId } });
  if (!prompt) {
    throw Object.assign(new Error("Prompt not found"), { status: 404 });
  }

  // Wrap in a transaction: clear the publishedVersionId FK first to break the circular
  // reference (Prompt.publishedVersionId → PromptVersion), then delete (cascades versions).
  await db.$transaction(async (tx) => {
    if (prompt.publishedVersionId) {
      await tx.prompt.update({ where: { id: promptId }, data: { publishedVersionId: null } });
    }
    await tx.prompt.delete({ where: { id: promptId } });
  });

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
