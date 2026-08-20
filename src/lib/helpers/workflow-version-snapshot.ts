/**
 * Enriches WORKFLOW artifacts with durable workflow-version snapshots captured
 * at ingestion time, so the Changes tab can show:
 *   1. each change along the way (previous version → this version), and
 *   2. the overall change (task's starting version → latest version).
 *
 * Why snapshots instead of live lookups:
 *  - Stakwork versions are immutable, but which version is "current"/"published"
 *    moves. Baking both sides into the artifact keeps a diff stable forever.
 *  - Only ONE source may ever feed a diff. The same version, read three ways:
 *      • API `data.workflow` — compact definition: transitions + connections
 *      • API `data.spec`     — render payload: icon urls, templates, positions
 *      • graph node `body`   — like data.workflow, but escapes `$` refs as `#`
 *    Every snapshot here therefore comes from API `data.workflow`, canonicalised,
 *    so both sides of a diff are always directly comparable.
 *
 * Security contract:
 *  - Only runs for workflow_editor tasks — the mode that owns this feature.
 *    (WORKFLOW artifacts also land on project_debugger tasks, which have no
 *    edit history to diff.)
 *  - The artifact's workflowId must match the task's WorkflowTask binding when
 *    one exists, so a webhook payload can't pull an unrelated workflow's spec
 *    into this task (IDOR guard).
 *  - Never logs spec bodies — only ids and byte counts.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { config } from "@/config/env";
import {
  ArtifactType,
  type PublishWorkflowContent,
  type WorkflowContent,
  type WorkflowVersionSnapshot,
} from "@/lib/chat";
import { Prisma } from "@prisma/client";

const LOG_CONTEXT = "workflow-version-snapshot";

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
  mode?: string | null;
};

// ── Canonicalisation ──────────────────────────────────────────────────────────

/**
 * Recursively sorts object keys so two specs that differ only in key order
 * produce byte-identical strings. Arrays keep their order (it is meaningful).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalises a workflow spec into a stable, diffable string.
 *
 * Handles the double-encoded string forms these payloads sometimes use, drops
 * the top-level `version` counter (metadata — the diff is already labelled with
 * the workflow version ids), and sorts keys so ordering never reads as a change.
 *
 * Returns undefined when the input cannot be parsed into an object.
 */
export function canonicalizeWorkflowSpec(raw: unknown): string | undefined {
  if (raw == null) return undefined;

  let data: unknown = raw;

  // Unwrap graph-style double encoding, then parse until we reach an object.
  if (typeof data === "string") {
    let text = data.trim();
    if (!text) return undefined;
    if (text.startsWith('\\"') && text.endsWith('\\"')) text = text.slice(2, -2);
    else if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
    data = text;

    let guard = 0;
    while (typeof data === "string" && guard++ < 5) {
      try {
        data = JSON.parse(data as string);
      } catch {
        return undefined;
      }
    }
  }

  if (!data || typeof data !== "object") return undefined;

  const spec = { ...(data as Record<string, unknown>) };
  delete spec.version; // metadata, not spec — differs by source

  try {
    return JSON.stringify(sortKeysDeep(spec), null, 2);
  } catch {
    return undefined;
  }
}

// ── Stakwork version fetch ────────────────────────────────────────────────────

/**
 * Pulls one workflow version's spec from Stakwork:
 *   GET /workflows/:workflowId?workflow_version_id=:workflowVersionId
 *
 * Returns the canonicalised spec string, or undefined on any failure (caller
 * treats that as "no snapshot" and leaves the artifact unenriched).
 */
export async function fetchWorkflowVersionSpec(
  workflowId: string | number,
  workflowVersionId: string | number,
): Promise<string | undefined> {
  if (!config.STAKWORK_API_KEY) {
    logger.info("STAKWORK_API_KEY not configured — skipping version fetch", LOG_CONTEXT, {
      workflowId,
      workflowVersionId,
    });
    return undefined;
  }

  const url =
    `${config.STAKWORK_BASE_URL}/workflows/${encodeURIComponent(String(workflowId))}` +
    `?workflow_version_id=${encodeURIComponent(String(workflowVersionId))}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      logger.error("Version fetch failed (non-ok)", LOG_CONTEXT, {
        workflowId,
        workflowVersionId,
        status: response.status,
        body: body.slice(0, 500),
      });
      return undefined;
    }

    const result = (await response.json()) as {
      data?: { workflow?: unknown };
    };

    // `data.workflow` only — the compact semantic definition (transitions +
    // connections). `data.spec` is the render-oriented payload and carries
    // icon urls, html templates, display ids and positions, all of which are
    // diff noise. Never mix the two: they describe the same version differently.
    const canonical = canonicalizeWorkflowSpec(result?.data?.workflow);

    if (!canonical) {
      logger.error("Version fetch returned no usable data.workflow", LOG_CONTEXT, {
        workflowId,
        workflowVersionId,
        dataKeys: result?.data ? Object.keys(result.data) : null,
      });
      return undefined;
    }

    logger.info("Captured workflow version spec", LOG_CONTEXT, {
      workflowId,
      workflowVersionId,
      bytes: canonical.length,
    });
    return canonical;
  } catch (error) {
    logger.error("Version fetch failed (thrown)", LOG_CONTEXT, {
      workflowId,
      workflowVersionId,
      error: String(error),
    });
    return undefined;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * For each WORKFLOW artifact in `chatMessage` carrying workflowId +
 * workflowVersionId and no snapshot yet, pull that version's spec and persist
 * it alongside the version it should be compared against.
 *
 * Best-effort: any artifact that can't be resolved is left as-is, and the
 * Changes tab falls back to its previous behaviour for that task.
 */
export async function enrichWorkflowArtifacts(
  chatMessage: MessageWithArtifacts,
  task: TaskContext,
): Promise<void> {
  const workflowArtifacts = chatMessage.artifacts.filter(
    (a) => a.type === ArtifactType.WORKFLOW,
  );
  if (workflowArtifacts.length === 0) return;

  // ── Mode gate ──────────────────────────────────────────────────────────────
  if (task.mode !== "workflow_editor") {
    logger.info("Skipping enrichment: task is not in workflow_editor mode", LOG_CONTEXT, {
      taskId: task.id,
      mode: task.mode ?? null,
    });
    return;
  }

  // ── IDOR guard: the workflow this task is bound to, when known ─────────────
  const workflowTask = await db.workflowTask.findUnique({
    where: { taskId: task.id },
    select: { workflowId: true },
  });
  const boundWorkflowId = workflowTask?.workflowId ?? null;

  for (const artifact of workflowArtifacts) {
    await enrichSingleArtifact(artifact, task, boundWorkflowId);
  }
}

async function enrichSingleArtifact(
  artifact: ArtifactRow,
  task: TaskContext,
  boundWorkflowId: number | null,
): Promise<void> {
  const content = artifact.content as WorkflowContent | null;
  if (!content) return;

  // Idempotent — never re-fetch or overwrite a captured snapshot.
  if (content.versionSnapshot !== undefined) return;

  const { workflowId, workflowVersionId } = content;
  if (workflowId == null || workflowVersionId == null || workflowId === "new") {
    logger.info("Artifact missing workflowId/workflowVersionId, skipping", LOG_CONTEXT, {
      artifactId: artifact.id,
      workflowId: workflowId ?? null,
    });
    return;
  }

  if (boundWorkflowId != null && String(boundWorkflowId) !== String(workflowId)) {
    logger.warn(
      "Skipping enrichment: artifact workflowId does not match the task's WorkflowTask binding (IDOR guard)",
      LOG_CONTEXT,
      { artifactId: artifact.id, artifactWorkflowId: workflowId, boundWorkflowId, taskId: task.id },
    );
    return;
  }

  const value = await fetchWorkflowVersionSpec(workflowId, workflowVersionId);
  if (!value) return; // logged upstream; leave artifact unenriched

  const versionSnapshot: WorkflowVersionSnapshot = {
    workflowVersionId: String(workflowVersionId),
    value,
  };

  const baselineSnapshot = await resolveBaselineSnapshot(
    task.id,
    artifact.id,
    workflowId,
    String(workflowVersionId),
    readPreviousVersionId(content),
  );

  const updatedContent: WorkflowContent = {
    ...content,
    versionSnapshot,
    baselineSnapshot,
    // Stakwork's version API is the source of truth for what this version
    // contains, so it also drives the Edit Steps view. The graph is not used:
    // a version created moments ago is often not ingested yet ("No data found"),
    // and its node shape differs from the API's.
    workflowJson: value,
  };

  await db.artifact.update({
    where: { id: artifact.id },
    data: { content: updatedContent as unknown as Prisma.InputJsonValue },
  });

  logger.info("Stored workflow version snapshot", LOG_CONTEXT, {
    artifactId: artifact.id,
    workflowId,
    workflowVersionId: versionSnapshot.workflowVersionId,
    baselineVersionId: baselineSnapshot?.workflowVersionId ?? null,
  });
}

/**
 * Reads the producer-supplied "this change was based on version X" field.
 *
 * Tolerates both spellings because the payload crosses a service boundary:
 * Hive's own artifact content is camelCase, Stakwork's API is snake_case, and
 * which one arrives depends on who wrote the emitting step.
 *
 * Returns a version id, or null for "explicitly nothing came before" / absent.
 */
function readPreviousVersionId(content: WorkflowContent): string | null {
  const raw =
    content.previousWorkflowVersionId ??
    (content as { previous_workflow_version_id?: string | number | null })
      .previous_workflow_version_id;

  if (raw == null) return null;
  const value = String(raw).trim();
  return value === "" || value === "null" ? null : value;
}

/**
 * Resolves what this artifact's change should be measured against:
 *
 *  1. `previousWorkflowVersionId`, when the producer supplied one. Authoritative
 *     — it is the only source that cannot be wrong about what this specific
 *     change forked from, and unlike a "currently published" pointer it cannot
 *     drift onto the change itself after a publish.
 *  2. Otherwise the newest earlier artifact in this task that already has a
 *     `versionSnapshot` — its spec is reused verbatim (already REST-sourced and
 *     canonical, no refetch).
 *  3. Otherwise the oldest earlier artifact with a different workflowVersionId
 *     — i.e. the version the task started from. Its spec is pulled from the
 *     REST API so both sides of the diff share a source.
 *  4. Otherwise null (nothing to compare against — renders as all-green).
 *
 * Steps 2-3 still run when the producer says `null`, because "brand-new
 * workflow" and "second change to a brand-new workflow" both report null on
 * some producers, and a prior artifact in the same task genuinely precedes this
 * one either way. For a truly new workflow's first artifact there are no priors,
 * so the answer is null regardless.
 */
async function resolveBaselineSnapshot(
  taskId: string,
  currentArtifactId: string,
  workflowId: string | number,
  currentVersionId: string,
  previousVersionId: string | null,
): Promise<WorkflowVersionSnapshot | null> {
  // 1. The producer told us exactly what this was based on.
  if (previousVersionId && previousVersionId !== currentVersionId) {
    const value = await fetchWorkflowVersionSpec(workflowId, previousVersionId);
    if (value) {
      logger.info("Baseline resolved from previousWorkflowVersionId", LOG_CONTEXT, {
        workflowId,
        currentVersionId,
        previousVersionId,
      });
      return { workflowVersionId: previousVersionId, value };
    }
    // Fetch failed (logged upstream) — fall through to the in-task history.
  }

  const priorArtifacts = await db.artifact.findMany({
    where: {
      type: ArtifactType.WORKFLOW,
      id: { not: currentArtifactId },
      message: { taskId },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, content: true, createdAt: true },
  });

  if (priorArtifacts.length === 0) return null;

  // 2. Newest earlier snapshot wins — that is "the previous change".
  for (let i = priorArtifacts.length - 1; i >= 0; i--) {
    const priorContent = priorArtifacts[i].content as WorkflowContent | null;
    const snapshot = priorContent?.versionSnapshot;
    if (
      snapshot?.value &&
      String(priorContent?.workflowId ?? workflowId) === String(workflowId) &&
      snapshot.workflowVersionId !== currentVersionId
    ) {
      return { workflowVersionId: snapshot.workflowVersionId, value: snapshot.value };
    }
  }

  // 3. Fall back to the task's starting version (oldest artifact with a version).
  for (const prior of priorArtifacts) {
    const priorContent = prior.content as WorkflowContent | null;
    const priorVersionId = priorContent?.workflowVersionId;
    if (
      priorVersionId == null ||
      String(priorContent?.workflowId ?? workflowId) !== String(workflowId) ||
      String(priorVersionId) === currentVersionId
    ) {
      continue;
    }

    const value = await fetchWorkflowVersionSpec(workflowId, priorVersionId);
    if (value) {
      return { workflowVersionId: String(priorVersionId), value };
    }
  }

  return null;
}

// ── PUBLISH_WORKFLOW enrichment ───────────────────────────────────────────────

/**
 * Enriches PUBLISH_WORKFLOW artifacts with durable version snapshots, mirroring
 * `enrichPublishScriptArtifacts` in script-version-snapshot.ts.
 *
 * A PUBLISH_WORKFLOW artifact already states both sides of its own diff
 * explicitly:
 *   - `workflowVersionId`         → the "updated" side (this publish)
 *   - `previousWorkflowVersionId` → the "baseline" side (what it was published
 *                                   over) — null means brand-new, nothing to
 *                                   compare against.
 *
 * Unlike WORKFLOW artifacts there is no in-task chain to resolve: the producer
 * already told us exactly what this change forked from, so this just pulls
 * both specs and pins them on the artifact as `versionSnapshot` /
 * `baselineSnapshot`, in the same shape the Changes tab already reads for
 * WORKFLOW artifacts (see `WorkflowContent`) so it picks them up unchanged.
 *
 * Best-effort: an artifact that can't be resolved is left as-is, and the
 * Changes tab simply has nothing to show for it (it is filtered out alongside
 * other artifacts lacking a `versionSnapshot`).
 */
export async function enrichPublishWorkflowArtifacts(
  chatMessage: MessageWithArtifacts,
  task: TaskContext,
): Promise<void> {
  const publishArtifacts = chatMessage.artifacts.filter(
    (a) => a.type === ArtifactType.PUBLISH_WORKFLOW,
  );
  if (publishArtifacts.length === 0) return;

  for (const artifact of publishArtifacts) {
    await enrichSinglePublishWorkflowArtifact(artifact, task);
  }
}

async function enrichSinglePublishWorkflowArtifact(
  artifact: ArtifactRow,
  task: TaskContext,
): Promise<void> {
  const content = artifact.content as PublishWorkflowContent | null;
  if (!content) return;

  // Idempotent — never re-fetch or overwrite a captured snapshot.
  if (content.versionSnapshot !== undefined) return;

  const { workflowId, workflowVersionId, previousWorkflowVersionId } = content;
  if (workflowId == null || workflowVersionId == null) {
    logger.info("Artifact missing workflowId/workflowVersionId, skipping", LOG_CONTEXT, {
      artifactId: artifact.id,
      taskId: task.id,
    });
    return;
  }

  const value = await fetchWorkflowVersionSpec(workflowId, workflowVersionId);
  if (!value) return; // logged upstream; leave the artifact unenriched

  const versionSnapshot: WorkflowVersionSnapshot = {
    workflowVersionId: String(workflowVersionId),
    value,
  };

  // null / absent previousWorkflowVersionId → nothing to compare against
  // (brand-new workflow at publish time).
  let baselineSnapshot: WorkflowVersionSnapshot | null = null;
  if (previousWorkflowVersionId != null) {
    const baselineValue = await fetchWorkflowVersionSpec(workflowId, previousWorkflowVersionId);
    if (baselineValue) {
      baselineSnapshot = {
        workflowVersionId: String(previousWorkflowVersionId),
        value: baselineValue,
      };
    }
    // Fetch failure (logged upstream) leaves baselineSnapshot null rather than
    // undefined — the artifact is still considered enriched (versionSnapshot is
    // set), it simply has nothing to diff against.
  }

  const updatedContent: PublishWorkflowContent = {
    ...content,
    versionSnapshot,
    baselineSnapshot,
  };

  await db.artifact.update({
    where: { id: artifact.id },
    data: { content: updatedContent as unknown as Prisma.InputJsonValue },
  });

  logger.info("Stored publish-workflow version snapshot", LOG_CONTEXT, {
    artifactId: artifact.id,
    workflowId,
    workflowVersionId: versionSnapshot.workflowVersionId,
    baselineVersionId: baselineSnapshot?.workflowVersionId ?? null,
  });
}
