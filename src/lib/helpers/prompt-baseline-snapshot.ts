/**
 * Enriches PUBLISH_PROMPT artifacts with stable baseline/version snapshots
 * captured once at ingestion time, so diffs don't drift when newer versions
 * are published later.
 *
 * What a baseline is (mirrors the WORKFLOW version chain):
 *  - The FIRST change to a prompt within a task is measured against the prompt's
 *    currently published version — "here is what publishing this would change".
 *  - Every change AFTER that is measured against the previous PUBLISH_PROMPT
 *    artifact in the same task, so the task reads as a chain of consecutive
 *    edits rather than N diffs against the same stale published text.
 *
 * Security contract:
 *  - Only runs for tasks in the "stakwork" workspace (mirrors the gate in
 *    /api/workflow/prompts/[id]/versions/route.ts).
 *  - Validates the promptId is legitimately linked to this task/workflow via
 *    PromptUsage before reading any prompt text (IDOR guard).
 *  - Never logs prompt body text — only promptId + numeric versionNumber.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ArtifactType,
  type PromptBaselineSnapshot,
  type PublishPromptContent,
} from "@/lib/chat";
import { Prisma } from "@prisma/client";

const LOG_CONTEXT = "prompt-baseline-snapshot";

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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * For each PUBLISH_PROMPT artifact in `chatMessage` that does not yet have
 * `baselineSnapshot`/`versionSnapshot`, resolve and persist those fields.
 *
 * This is a best-effort enrichment — any individual artifact that cannot be
 * fully resolved is skipped with a log entry, leaving the artifact as-is so
 * the render path falls back to the legacy live-lookup.
 */
export async function enrichPublishPromptArtifacts(
  chatMessage: MessageWithArtifacts,
  task: TaskContext,
): Promise<void> {
  // ── 1. Workspace gate ──────────────────────────────────────────────────────
  // Only enrich for tasks in the "stakwork" workspace — prompt text is gated
  // behind stakwork-workspace membership by the live /versions endpoint, and
  // baking it into artifact content must have the same gate.
  const stakworkWorkspace = await db.workspace.findFirst({
    where: { slug: "stakwork", id: task.workspaceId },
    select: { id: true },
  });

  if (!stakworkWorkspace) {
    logger.info(
      "[prompt-baseline-snapshot] Skipping enrichment: task is not in stakwork workspace",
      "prompt-baseline-snapshot",
      { taskId: task.id, workspaceId: task.workspaceId },
    );
    return;
  }

  // ── 2. Collect PUBLISH_PROMPT artifacts that need enrichment ───────────────
  const publishPromptArtifacts = chatMessage.artifacts.filter(
    (a) => a.type === ArtifactType.PUBLISH_PROMPT,
  );

  if (publishPromptArtifacts.length === 0) return;

  // ── 3. Build the set of promptIds linked to this task (IDOR guard) ─────────
  // We check PromptUsage rows scoped to this task's workspace.  A promptId
  // that has no PromptUsage in this workspace is rejected before we read any
  // prompt text.
  const linkedPromptIds = await resolveLinkedPromptIds(task.workspaceId);

  // ── 4. Enrich each artifact, oldest version first ──────────────────────────
  // Each artifact's baseline may be the previous artifact's captured version, so
  // a batch has to be walked in version order for the chain to link up.
  const ordered = await orderByVersionNumber(publishPromptArtifacts);

  for (const artifact of ordered) {
    await enrichSingleArtifact(artifact, linkedPromptIds, task);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Sorts a batch of artifacts by their prompt version number, oldest first.
 *
 * Artifacts in one webhook payload share a `createdAt`, so version number is the
 * only monotonic key available. Artifacts whose version can't be resolved keep
 * their relative position (the sort is stable).
 */
async function orderByVersionNumber(artifacts: ArtifactRow[]): Promise<ArtifactRow[]> {
  if (artifacts.length < 2) return artifacts;

  const versionIds = artifacts
    .map((a) => (a.content as PublishPromptContent | null)?.promptVersionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (versionIds.length === 0) return artifacts;

  const versions = await db.promptVersion.findMany({
    where: { id: { in: versionIds } },
    select: { id: true, versionNumber: true },
  });

  const numberById = new Map(versions.map((v) => [v.id, v.versionNumber]));

  return artifacts
    .map((artifact, index) => {
      const versionId = (artifact.content as PublishPromptContent | null)?.promptVersionId;
      return {
        artifact,
        index,
        versionNumber: versionId ? numberById.get(versionId) : undefined,
      };
    })
    .sort((a, b) => {
      if (a.versionNumber === undefined || b.versionNumber === undefined) {
        return a.index - b.index;
      }
      return a.versionNumber - b.versionNumber || a.index - b.index;
    })
    .map((entry) => entry.artifact);
}

/**
 * The previous change to this prompt within the same task: the captured version
 * with the highest number strictly below this artifact's own.
 *
 * Returns null when this is the task's first change to the prompt — the caller
 * then falls back to the prompt's published version.
 *
 * Ordering is by version number rather than `createdAt` because artifacts from
 * one webhook payload share a timestamp. Only artifacts that already carry a
 * `versionSnapshot` count, so an unenriched artifact never becomes a baseline.
 */
async function resolveChainBaseline(
  taskId: string,
  currentArtifactId: string,
  promptId: string,
  currentVersionNumber: number,
): Promise<PromptBaselineSnapshot | null> {
  const priorArtifacts = await db.artifact.findMany({
    where: {
      type: ArtifactType.PUBLISH_PROMPT,
      id: { not: currentArtifactId },
      message: { taskId },
    },
    select: { id: true, content: true },
  });

  let best: PromptBaselineSnapshot | null = null;

  for (const prior of priorArtifacts) {
    const content = prior.content as PublishPromptContent | null;
    if (!content || content.promptId !== promptId || !content.promptVersionId) continue;

    const snapshot = content.versionSnapshot;
    if (typeof snapshot?.value !== "string" || typeof snapshot.versionNumber !== "number") {
      continue;
    }
    if (snapshot.versionNumber >= currentVersionNumber) continue;
    if (best && snapshot.versionNumber <= best.versionNumber) continue;

    best = {
      value: snapshot.value,
      versionId: content.promptVersionId,
      versionNumber: snapshot.versionNumber,
      source: "chain",
    };
  }

  return best;
}

/**
 * Returns the Set of promptIds legitimately linked to `workspaceId` via
 * PromptUsage rows.  An empty set means no prompts are linked (all IDOR
 * checks will fail), which is the safe default.
 */
async function resolveLinkedPromptIds(workspaceId: string): Promise<Set<string>> {
  const usages = await db.promptUsage.findMany({
    where: { workspaceId, promptId: { not: null } },
    select: { promptId: true },
  });
  const ids = new Set<string>();
  for (const u of usages) {
    if (u.promptId) ids.add(u.promptId);
  }
  return ids;
}

async function enrichSingleArtifact(
  artifact: ArtifactRow,
  linkedPromptIds: Set<string>,
  task: TaskContext,
): Promise<void> {
  const content = artifact.content as PublishPromptContent | null;
  if (!content) return;

  const { promptId, promptVersionId } = content;

  // Skip if already has snapshots (idempotent).
  if ("baselineSnapshot" in content || "versionSnapshot" in content) {
    logger.info(
      "[prompt-baseline-snapshot] Snapshot already present, skipping",
      "prompt-baseline-snapshot",
      { artifactId: artifact.id, promptId },
    );
    return;
  }

  if (!promptId || !promptVersionId) {
    logger.info(
      "[prompt-baseline-snapshot] Artifact missing promptId or promptVersionId, skipping",
      "prompt-baseline-snapshot",
      { artifactId: artifact.id },
    );
    return;
  }

  // ── IDOR guard ─────────────────────────────────────────────────────────────
  if (!linkedPromptIds.has(promptId)) {
    logger.warn(
      "[prompt-baseline-snapshot] Skipping enrichment: promptId not linked to workspace via PromptUsage (IDOR guard)",
      "prompt-baseline-snapshot",
      { promptId, taskId: task.id, workspaceId: task.workspaceId },
    );
    return;
  }

  // ── Fetch this artifact's own version ──────────────────────────────────────
  const thisVersion = await db.promptVersion.findUnique({
    where: { id: promptVersionId },
    select: { id: true, value: true, versionNumber: true, promptId: true },
  });

  if (!thisVersion) {
    logger.info(
      "[prompt-baseline-snapshot] Artifact version not found in DB (Stakwork sync lag?), skipping",
      "prompt-baseline-snapshot",
      { promptId, promptVersionId, taskId: task.id },
    );
    return;
  }

  // Confirm the fetched version actually belongs to the verified prompt.
  // Without this check a caller-supplied promptVersionId from a different
  // prompt would pass the promptId IDOR guard yet still read that other
  // prompt's text into the snapshot.
  if (thisVersion.promptId !== promptId) {
    logger.warn(
      "[prompt-baseline-snapshot] Skipping enrichment: promptVersionId does not belong to promptId (IDOR guard)",
      "prompt-baseline-snapshot",
      { promptId, promptVersionId, taskId: task.id },
    );
    return;
  }

  // ── Fetch the prompt row with its published version ────────────────────────
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    include: { publishedVersion: true },
  });

  if (!prompt) {
    logger.info(
      "[prompt-baseline-snapshot] Prompt row not found in DB (Stakwork sync lag?), skipping",
      "prompt-baseline-snapshot",
      { promptId, taskId: task.id },
    );
    return;
  }

  const versionSnapshot = {
    value: thisVersion.value,
    versionNumber: thisVersion.versionNumber,
  };

  // ── Baseline ───────────────────────────────────────────────────────────────
  // The previous change in this task wins: after the first artifact, each change
  // is measured against the one before it. Only when this is the task's first
  // change to the prompt do we fall back to the published version below.
  let baselineSnapshot: PromptBaselineSnapshot | null = await resolveChainBaseline(
    task.id,
    artifact.id,
    promptId,
    thisVersion.versionNumber,
  );

  if (baselineSnapshot) {
    logger.info(
      "[prompt-baseline-snapshot] Baseline resolved to the previous change in this task",
      LOG_CONTEXT,
      {
        promptId,
        taskId: task.id,
        baselineVersionNumber: baselineSnapshot.versionNumber,
        versionNumber: thisVersion.versionNumber,
      },
    );
  } else if (!prompt.publishedVersion) {
    // Brand-new prompt — no published version yet.
    logger.info(
      "[prompt-baseline-snapshot] No published baseline (new prompt)",
      "prompt-baseline-snapshot",
      { promptId, versionNumber: thisVersion.versionNumber },
    );
    baselineSnapshot = null;
  } else if (prompt.publishedVersion.id === promptVersionId) {
    // Drift guard: the artifact's own version is already the published one.
    // publishVersion sets other versions' `published: false` but preserves their
    // `publishedAt`, so the previously-published version is the one (other than
    // this one) with the greatest non-null `publishedAt`.
    const previouslyPublished = await db.promptVersion.findFirst({
      where: {
        promptId,
        id: { not: promptVersionId },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      select: { id: true, value: true, versionNumber: true },
    });

    if (previouslyPublished) {
      baselineSnapshot = {
        value: previouslyPublished.value,
        versionId: previouslyPublished.id,
        versionNumber: previouslyPublished.versionNumber,
        source: "published",
      };
      logger.info(
        "[prompt-baseline-snapshot] Drift guard applied — baseline resolved to previously published version",
        "prompt-baseline-snapshot",
        { promptId, baselineVersionNumber: previouslyPublished.versionNumber },
      );
    } else {
      // No previously-published version — fall back to the numerically-highest
      // version strictly below this one (covers prompts with no publish history).
      const priorByNumber = await db.promptVersion.findFirst({
        where: {
          promptId,
          versionNumber: { lt: thisVersion.versionNumber },
        },
        orderBy: { versionNumber: "desc" },
        select: { id: true, value: true, versionNumber: true },
      });

      if (priorByNumber) {
        baselineSnapshot = {
          value: priorByNumber.value,
          versionId: priorByNumber.id,
          versionNumber: priorByNumber.versionNumber,
          source: "published",
        };
        logger.info(
          "[prompt-baseline-snapshot] Drift guard applied — no publishedAt history, baseline resolved to prior version by number",
          "prompt-baseline-snapshot",
          { promptId, baselineVersionNumber: priorByNumber.versionNumber },
        );
      } else {
        // No prior version exists at all — treat as first-ever publish.
        baselineSnapshot = null;
        logger.info(
          "[prompt-baseline-snapshot] Drift guard applied — no prior published version, baseline=null",
          "prompt-baseline-snapshot",
          { promptId },
        );
      }
    }
  } else {
    // Normal case: published version is different from this artifact's version.
    baselineSnapshot = {
      value: prompt.publishedVersion.value,
      versionId: prompt.publishedVersion.id,
      versionNumber: prompt.publishedVersion.versionNumber,
      source: "published",
    };
    logger.info(
      "[prompt-baseline-snapshot] Captured baseline snapshot",
      "prompt-baseline-snapshot",
      {
        promptId,
        baselineVersionNumber: prompt.publishedVersion.versionNumber,
        versionNumber: thisVersion.versionNumber,
      },
    );
  }

  // ── Persist durably ────────────────────────────────────────────────────────
  const updatedContent = {
    ...content,
    baselineSnapshot,
    versionSnapshot,
  };

  await db.artifact.update({
    where: { id: artifact.id },
    data: { content: updatedContent as unknown as Prisma.InputJsonValue },
  });
}
