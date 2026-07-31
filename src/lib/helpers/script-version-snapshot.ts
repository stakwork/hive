/**
 * Enriches PUBLISH_SCRIPT artifacts with durable script-version snapshots pulled
 * from Stakwork at ingestion time, so the Changes tab can show:
 *   1. each change along the way (previous version → this version), and
 *   2. the overall change (the version the task started from → latest version).
 *
 * What a baseline is (same contract as WORKFLOW and PUBLISH_PROMPT):
 *  - The FIRST change to a script within a task is measured against what is live
 *    — the published version, or the version immediately below it when the
 *    script has never been published.
 *  - Every change AFTER that is measured against the previous PUBLISH_SCRIPT
 *    artifact in the same task, so a task reads as a chain of consecutive edits.
 *
 * Why snapshots instead of live lookups:
 *  - Stakwork versions are immutable, but `published_version_id` moves. Baking
 *    both sides into the artifact keeps a diff stable after a publish — without
 *    it, publishing a change makes it diff against itself and read as "no
 *    changes detected".
 *
 * Security contract:
 *  - Only runs for tasks in the "stakwork" workspace, the same gate the
 *    /api/workflow/scripts/* proxies apply. Those proxies already serve any
 *    script's source to any member of that workspace, so capturing a body into
 *    an artifact in that same workspace exposes nothing new.
 *  - Never logs script source — only ids, version numbers and byte counts.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { config } from "@/config/env";
import {
  ArtifactType,
  type PublishScriptContent,
  type ScriptBaselineSnapshot,
} from "@/lib/chat";
import { Prisma } from "@prisma/client";

const LOG_CONTEXT = "script-version-snapshot";

// ── Types ─────────────────────────────────────────────────────────────────────

type ArtifactRow = {
  id: string;
  type: string | null;
  content: Prisma.JsonValue | null;
};

type MessageWithArtifacts = {
  id: string;
  taskId?: string | null;
  artifacts: ArtifactRow[];
};

type TaskContext = {
  id: string;
  workspaceId: string;
};

/** One version's body as Stakwork returns it. */
type ScriptVersion = {
  versionId: number;
  versionNumber: number;
  value: string;
};

// ── Stakwork API ──────────────────────────────────────────────────────────────

async function stakworkGet<T>(path: string): Promise<T | undefined> {
  if (!config.STAKWORK_API_KEY) {
    logger.info("STAKWORK_API_KEY not configured — skipping script fetch", LOG_CONTEXT, { path });
    return undefined;
  }

  try {
    const response = await fetch(`${config.STAKWORK_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      logger.error("Script fetch failed (non-ok)", LOG_CONTEXT, {
        path,
        status: response.status,
        body: body.slice(0, 300),
      });
      return undefined;
    }

    const result = (await response.json()) as { success?: boolean; data?: T };
    if (result?.success === false || !result?.data) {
      logger.error("Script fetch returned no data", LOG_CONTEXT, { path });
      return undefined;
    }

    return result.data;
  } catch (error) {
    logger.error("Script fetch failed (thrown)", LOG_CONTEXT, { path, error: String(error) });
    return undefined;
  }
}

/**
 * One script version's source:
 *   GET /scripts/:scriptId/versions/:versionId
 */
export async function fetchScriptVersion(
  scriptId: number | string,
  versionId: number | string,
): Promise<ScriptVersion | undefined> {
  const data = await stakworkGet<{
    version_id?: number;
    version_number?: number;
    source_code?: string;
    value?: string;
  }>(
    `/scripts/${encodeURIComponent(String(scriptId))}/versions/${encodeURIComponent(String(versionId))}`,
  );

  const value = data?.source_code ?? data?.value;
  if (typeof value !== "string" || typeof data?.version_number !== "number") {
    if (data) {
      logger.error("Script version missing source_code/version_number", LOG_CONTEXT, {
        scriptId,
        versionId,
      });
    }
    return undefined;
  }

  logger.info("Captured script version", LOG_CONTEXT, {
    scriptId,
    versionId,
    versionNumber: data.version_number,
    bytes: value.length,
  });

  return {
    versionId: data.version_id ?? Number(versionId),
    versionNumber: data.version_number,
    value,
  };
}

/**
 * Fetches a version identified by either its version *id* or its version
 * *number*.
 *
 * The two are easy to confuse — Stakwork's per-version endpoint is keyed by id
 * (302), while everything a human reads talks in numbers (v2) — and a payload
 * carrying the number 404s against an id-keyed route. When the direct lookup
 * misses we resolve the value against the version list and retry with the id.
 */
async function fetchScriptVersionByIdOrNumber(
  scriptId: number | string,
  idOrNumber: number,
): Promise<ScriptVersion | undefined> {
  const direct = await fetchScriptVersion(scriptId, idOrNumber);
  if (direct) return direct;

  const match = (await fetchVersionList(scriptId)).find((v) => v.version_number === idOrNumber);
  if (!match || match.id === idOrNumber) return undefined;

  logger.info("Resolved a version number to its version id", LOG_CONTEXT, {
    scriptId,
    versionNumber: idOrNumber,
    versionId: match.id,
  });

  return fetchScriptVersion(scriptId, match.id);
}

/** The script's published version id, or null when nothing is published yet. */
async function fetchPublishedVersionId(scriptId: number | string): Promise<number | null> {
  const data = await stakworkGet<{ published_version_id?: number | null }>(
    `/scripts/${encodeURIComponent(String(scriptId))}`,
  );
  return data?.published_version_id ?? null;
}

/**
 * The version metadata list (no source bodies):
 *   GET /scripts/:scriptId/versions
 */
async function fetchVersionList(
  scriptId: number | string,
): Promise<Array<{ id: number; version_number: number }>> {
  const data = await stakworkGet<{
    versions?: Array<{ id?: number; version_number?: number }>;
  }>(`/scripts/${encodeURIComponent(String(scriptId))}/versions`);

  return (data?.versions ?? []).filter(
    (v): v is { id: number; version_number: number } =>
      typeof v?.id === "number" && typeof v?.version_number === "number",
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * For each PUBLISH_SCRIPT artifact in `chatMessage` without a snapshot yet, pull
 * that version's source and persist it alongside the version it should be
 * compared against.
 *
 * Best-effort: an artifact that can't be resolved is left as-is, and the Changes
 * tab rebuilds its diff live for that item.
 */
export async function enrichPublishScriptArtifacts(
  chatMessage: MessageWithArtifacts,
  task: TaskContext,
): Promise<void> {
  const scriptArtifacts = chatMessage.artifacts.filter(
    (a) => a.type === ArtifactType.PUBLISH_SCRIPT,
  );
  if (scriptArtifacts.length === 0) return;

  // ── Workspace gate ─────────────────────────────────────────────────────────
  const stakworkWorkspace = await db.workspace.findFirst({
    where: { slug: "stakwork", id: task.workspaceId },
    select: { id: true },
  });

  if (!stakworkWorkspace) {
    logger.info("Skipping enrichment: task is not in stakwork workspace", LOG_CONTEXT, {
      taskId: task.id,
      workspaceId: task.workspaceId,
    });
    return;
  }

  // Oldest version first — an artifact's baseline may be the previous artifact's
  // captured version, so a batch has to be walked in order for the chain to link.
  const ordered = [...scriptArtifacts].sort((a, b) => {
    const va = (a.content as PublishScriptContent | null)?.scriptVersionId ?? 0;
    const vb = (b.content as PublishScriptContent | null)?.scriptVersionId ?? 0;
    return va - vb;
  });

  for (const artifact of ordered) {
    await enrichSingleArtifact(artifact, task);
  }
}

async function enrichSingleArtifact(artifact: ArtifactRow, task: TaskContext): Promise<void> {
  const content = artifact.content as PublishScriptContent | null;
  if (!content) return;

  // Idempotent — never re-fetch or overwrite a captured snapshot.
  if (content.versionSnapshot !== undefined) return;

  const { scriptId, scriptVersionId } = content;
  if (scriptId == null || scriptVersionId == null) {
    logger.info("Artifact missing scriptId/scriptVersionId, skipping", LOG_CONTEXT, {
      artifactId: artifact.id,
    });
    return;
  }

  const thisVersion = await fetchScriptVersionByIdOrNumber(scriptId, scriptVersionId);
  if (!thisVersion) return; // logged upstream; leave the artifact unenriched

  const baselineSnapshot = await resolveBaselineSnapshot(
    task.id,
    artifact.id,
    scriptId,
    thisVersion,
  );

  const updatedContent: PublishScriptContent = {
    ...content,
    versionSnapshot: { value: thisVersion.value, versionNumber: thisVersion.versionNumber },
    baselineSnapshot,
  };

  await db.artifact.update({
    where: { id: artifact.id },
    data: { content: updatedContent as unknown as Prisma.InputJsonValue },
  });

  logger.info("Stored script version snapshot", LOG_CONTEXT, {
    artifactId: artifact.id,
    scriptId,
    versionNumber: thisVersion.versionNumber,
    baselineVersionNumber: baselineSnapshot?.versionNumber ?? null,
    baselineSource: baselineSnapshot?.source ?? null,
  });
}

/**
 * Resolves what this artifact's change is measured against:
 *
 *  1. The previous PUBLISH_SCRIPT artifact for the same script in this task —
 *     the captured version with the highest number strictly below this one. Its
 *     body is reused verbatim, so no refetch and both sides share a source.
 *  2. Otherwise (the task's first change) the script's published version.
 *  3. Otherwise the version immediately below this one — what the script was at
 *     when the task started, for scripts that have never been published.
 *  4. Otherwise null: nothing to compare against, which renders all-green.
 */
async function resolveBaselineSnapshot(
  taskId: string,
  currentArtifactId: string,
  scriptId: number,
  thisVersion: ScriptVersion,
): Promise<ScriptBaselineSnapshot | null> {
  // 1. Previous change in this task.
  const priorArtifacts = await db.artifact.findMany({
    where: {
      type: ArtifactType.PUBLISH_SCRIPT,
      id: { not: currentArtifactId },
      message: { taskId },
    },
    select: { id: true, content: true },
  });

  let chained: ScriptBaselineSnapshot | null = null;

  for (const prior of priorArtifacts) {
    const priorContent = prior.content as PublishScriptContent | null;
    if (!priorContent || Number(priorContent.scriptId) !== Number(scriptId)) continue;

    const snapshot = priorContent.versionSnapshot;
    if (typeof snapshot?.value !== "string" || typeof snapshot.versionNumber !== "number") {
      continue;
    }
    if (snapshot.versionNumber >= thisVersion.versionNumber) continue;
    if (chained && snapshot.versionNumber <= chained.versionNumber) continue;

    chained = {
      value: snapshot.value,
      versionId: priorContent.scriptVersionId,
      versionNumber: snapshot.versionNumber,
      source: "chain",
    };
  }

  if (chained) return chained;

  // 2. The published version, when it is not this artifact's own version.
  const publishedVersionId = await fetchPublishedVersionId(scriptId);
  if (publishedVersionId != null && Number(publishedVersionId) !== Number(thisVersion.versionId)) {
    const published = await fetchScriptVersion(scriptId, publishedVersionId);
    if (published) {
      return {
        value: published.value,
        versionId: published.versionId,
        versionNumber: published.versionNumber,
        source: "published",
      };
    }
  }

  // 3. The version immediately below this one — positional, so it stays put when
  //    the published pointer moves (including onto this very version).
  const versions = await fetchVersionList(scriptId);
  const previous = versions
    .filter((v) => v.version_number < thisVersion.versionNumber)
    .sort((a, b) => b.version_number - a.version_number)[0];

  if (previous) {
    const prior = await fetchScriptVersion(scriptId, previous.id);
    if (prior) {
      return {
        value: prior.value,
        versionId: prior.versionId,
        versionNumber: prior.versionNumber,
        source: "prior",
      };
    }
  }

  // 4. Brand-new script — nothing to compare against.
  logger.info("No baseline available (first version of the script)", LOG_CONTEXT, {
    scriptId,
    versionNumber: thisVersion.versionNumber,
  });
  return null;
}
