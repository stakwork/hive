/**
 * Layer 1: Automated Metrics
 *
 * Pure computation from existing DB data. No LLM calls.
 * Uses bulk queries to avoid connection pool exhaustion.
 *
 * Caching strategy:
 *  - Per-feature metrics cached in ScorerDigest.metadata (JSON)
 *  - Aggregate metrics cached in Workspace.scorerAggregateCache (JSON)
 *  - Both written by computeAndCacheMetrics(), read by loadCachedMetrics()
 *  - 1-hour TTL based on aggregate cache timestamp
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Affirmation filter for correction counting
// ---------------------------------------------------------------------------

const AFFIRMATIONS = new Set([
  "yes", "ok", "y", "go", "sure", "do it", "looks good", "proceed",
  "continue", "approved", "lgtm", "next", "go ahead", "yep", "yup",
  "yeah", "correct", "right", "perfect", "great", "good", "fine",
  "agreed", "confirmed", "ship it", "merge it", "thanks", "thank you",
  "cool", "nice", "done", "k", "okay",
]);

function isAffirmation(msg: string): boolean {
  const normalized = msg.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (AFFIRMATIONS.has(normalized)) return true;
  if (normalized.length < 10) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskMetrics {
  taskId: string;
  taskTitle: string;
  featureId: string | null;
  messageCount: number;
  correctionCount: number;
  ciPassedFirstAttempt: boolean | null;
  prStatus: string | null;
  prUrl: string | null;
  durationMinutes: number | null;
  haltRetryAttempted: boolean;
  filesTouched: FileAction[];
}

export interface FileAction {
  file: string;
  action: string;
}

export interface FeatureMetrics {
  featureId: string;
  featureTitle: string;
  featureStatus: string;
  workspaceId: string;
  taskCount: number;
  taskCompletionRate: number;
  totalMessages: number;
  totalCorrections: number;
  planPrecision: number | null;
  planRecall: number | null;
  filesPlanned: string[];
  filesTouched: string[];
  tasks: TaskMetrics[];
}

export interface AggregateMetrics {
  featureCount: number;
  avgMessagesPerTask: number;
  ciPassRate: number;
  avgPlanPrecision: number;
  avgPlanRecall: number;
  prMergeRate: number;
}

interface AggregateCache {
  aggregate: AggregateMetrics;
  cachedAt: string; // ISO timestamp
  totalFeatures: number;
}

// ---------------------------------------------------------------------------
// File path extraction from architecture text
// ---------------------------------------------------------------------------

const FILE_PATH_RE = /(?:^|[\s`"'(,])([a-zA-Z][\w./-]*\/[\w./-]+\.\w{1,10})(?:[\s`"'),]|$)/gm;

function extractFilePaths(text: string | null): string[] {
  if (!text) return [];
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    paths.add(match[1]);
  }
  return Array.from(paths);
}

// ---------------------------------------------------------------------------
// Helpers for artifact parsing
// ---------------------------------------------------------------------------

interface DiffActionResult {
  file?: string;
  action?: string;
}

/**
 * Strip repo-name prefix from DIFF file paths.
 * e.g. "hive/src/app/foo.ts" → "src/app/foo.ts"
 */
function normalizeFilePath(path: string): string {
  const firstSlash = path.indexOf("/");
  if (firstSlash > 0) {
    const firstSegment = path.slice(0, firstSlash);
    // If first segment has no dot, it's likely a repo name prefix
    if (!firstSegment.includes(".")) {
      return path.slice(firstSlash + 1);
    }
  }
  return path;
}

function extractFilesFromDiffs(
  artifacts: Array<{ content: unknown }>
): FileAction[] {
  const fileMap = new Map<string, string>();
  for (const artifact of artifacts) {
    const raw = artifact.content;
    if (!raw) continue;

    // Handle both shapes: [{file, action}] and {diffs: [{file, action}]}
    let items: DiffActionResult[];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (
      typeof raw === "object" &&
      Array.isArray((raw as Record<string, unknown>).diffs)
    ) {
      items = (raw as Record<string, unknown>).diffs as DiffActionResult[];
    } else {
      continue;
    }

    for (const item of items) {
      if (item.file) {
        const normalized = normalizeFilePath(item.file);
        fileMap.set(normalized, item.action || "modify");
      }
    }
  }
  return Array.from(fileMap.entries()).map(([file, action]) => ({
    file,
    action,
  }));
}

interface PrArtifactContent {
  url?: string;
  status?: string;
}

function extractPrInfo(
  artifacts: Array<{ content: unknown }>
): { url: string | null; status: string | null } {
  for (const a of artifacts) {
    const content = a.content as PrArtifactContent | null;
    if (content?.url) {
      return { url: content.url, status: content.status || null };
    }
  }
  return { url: null, status: null };
}

// ---------------------------------------------------------------------------
// Bulk compute + cache
// ---------------------------------------------------------------------------

/**
 * Compute all metrics for a workspace in bulk (2 DB queries),
 * then cache: per-feature in ScorerDigest.metadata, aggregate
 * in Workspace.scorerAggregateCache.
 */
export async function computeAndCacheMetrics(
  workspaceId: string,
  since?: Date
): Promise<{ aggregate: AggregateMetrics; features: FeatureMetrics[] }> {
  const result = await computeAggregateMetrics(workspaceId, since);

  // Cache per-feature metrics into ScorerDigest rows
  if (result.features.length > 0) {
    await db.$transaction(
      result.features.map((f) =>
        db.scorerDigest.upsert({
          where: { featureId: f.featureId },
          create: {
            featureId: f.featureId,
            workspaceId,
            metadata: JSON.parse(JSON.stringify(f)),
          },
          update: {
            metadata: JSON.parse(JSON.stringify(f)),
          },
        })
      )
    );
  }

  // Cache aggregate on workspace
  const cache: AggregateCache = {
    aggregate: result.aggregate,
    cachedAt: new Date().toISOString(),
    totalFeatures: result.features.length,
  };
  await db.workspace.update({
    where: { id: workspaceId },
    data: { scorerAggregateCache: JSON.parse(JSON.stringify(cache)) },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Load from cache (paginated)
// ---------------------------------------------------------------------------

const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Load cached aggregate from Workspace + paginated feature metrics
 * from ScorerDigest rows. Returns null on cache miss or staleness.
 */
export async function loadCachedMetrics(
  workspaceId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  aggregate: AggregateMetrics;
  features: FeatureMetrics[];
  totalFeatures: number;
  totalPages: number;
} | null> {
  // Read aggregate cache from workspace
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { scorerAggregateCache: true },
  });

  const raw = workspace?.scorerAggregateCache as AggregateCache | null;
  if (!raw?.cachedAt) return null;

  // Check staleness
  if (Date.now() - new Date(raw.cachedAt).getTime() > CACHE_TTL) return null;

  const totalFeatures = raw.totalFeatures || 0;
  const totalPages = Math.max(1, Math.ceil(totalFeatures / pageSize));
  const skip = (page - 1) * pageSize;

  // Paginated read of feature metrics from digest rows
  const digests = await db.scorerDigest.findMany({
    where: { workspaceId },
    select: { metadata: true },
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
  });

  const features: FeatureMetrics[] = [];
  for (const d of digests) {
    const m = d.metadata as Record<string, unknown> | null;
    if (m?.featureId) {
      features.push(m as unknown as FeatureMetrics);
    }
  }

  return {
    aggregate: raw.aggregate,
    features,
    totalFeatures,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// Raw compute (no caching, used internally)
// ---------------------------------------------------------------------------

function computeAggregateMetrics(
  workspaceId: string,
  since?: Date
): Promise<{ aggregate: AggregateMetrics; features: FeatureMetrics[] }> {
  return computeMetricsBulk(workspaceId, since);
}

async function computeMetricsBulk(
  workspaceId: string,
  since?: Date
): Promise<{ aggregate: AggregateMetrics; features: FeatureMetrics[] }> {
  const dateFilter = since ? { createdAt: { gte: since } } : {};

  // Single query: all features with their tasks and user messages
  const features = await db.feature.findMany({
    where: { workspaceId, deleted: false, ...dateFilter },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      workspaceId: true,
      architecture: true,
      tasks: {
        where: { deleted: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          featureId: true,
          workflowStartedAt: true,
          workflowCompletedAt: true,
          haltRetryAttempted: true,
          chatMessages: {
            where: { role: "USER" },
            select: { message: true },
            orderBy: { timestamp: "asc" },
          },
        },
      },
    },
  });

  // Collect all task IDs for a single bulk artifact query
  const allTaskIds = features.flatMap((f) => f.tasks.map((t) => t.id));

  // Single query: all artifacts for all tasks (DIFF + PULL_REQUEST only)
  const allArtifacts =
    allTaskIds.length > 0
      ? await db.artifact.findMany({
          where: {
            message: { taskId: { in: allTaskIds } },
            type: { in: ["DIFF", "PULL_REQUEST"] },
          },
          select: {
            type: true,
            content: true,
            message: { select: { taskId: true } },
          },
        })
      : [];

  // Index artifacts by taskId
  const artifactsByTask = new Map<
    string,
    Array<{ type: string; content: unknown }>
  >();
  for (const a of allArtifacts) {
    const taskId = a.message.taskId;
    if (!taskId) continue;
    const list = artifactsByTask.get(taskId) || [];
    list.push({ type: a.type, content: a.content });
    artifactsByTask.set(taskId, list);
  }

  // Compute metrics in memory
  const featureMetrics: FeatureMetrics[] = features.map((feature) => {
    const taskMetrics: TaskMetrics[] = feature.tasks.map((task) => {
      const artifacts = artifactsByTask.get(task.id) || [];
      const diffArtifacts = artifacts.filter((a) => a.type === "DIFF");
      const prArtifacts = artifacts.filter((a) => a.type === "PULL_REQUEST");

      const filesTouched = extractFilesFromDiffs(diffArtifacts);
      const prInfo = extractPrInfo(prArtifacts);

      const messageCount = task.chatMessages.length;
      const correctionCount =
        messageCount <= 1
          ? 0
          : task.chatMessages
              .slice(1)
              .filter((m) => !isAffirmation(m.message)).length;

      const ciPassedFirstAttempt =
        prInfo.status === "DONE" ? !task.haltRetryAttempted : null;

      const durationMinutes =
        task.workflowStartedAt && task.workflowCompletedAt
          ? Math.round(
              (task.workflowCompletedAt.getTime() -
                task.workflowStartedAt.getTime()) /
                60000
            )
          : null;

      return {
        taskId: task.id,
        taskTitle: task.title,
        featureId: task.featureId,
        messageCount,
        correctionCount,
        ciPassedFirstAttempt,
        prStatus: prInfo.status,
        prUrl: prInfo.url,
        durationMinutes,
        haltRetryAttempted: task.haltRetryAttempted,
        filesTouched,
      };
    });

    const totalMessages = taskMetrics.reduce(
      (sum, t) => sum + t.messageCount,
      0
    );
    const totalCorrections = taskMetrics.reduce(
      (sum, t) => sum + t.correctionCount,
      0
    );
    const mergedCount = taskMetrics.filter(
      (t) => t.prStatus === "DONE"
    ).length;
    const taskCompletionRate =
      feature.tasks.length > 0
        ? Math.round((mergedCount / feature.tasks.length) * 100)
        : 0;

    const filesPlanned = extractFilePaths(feature.architecture);
    const allTouchedFiles = [
      ...new Set(
        taskMetrics.flatMap((t) => t.filesTouched.map((f) => f.file))
      ),
    ];

    let planPrecision: number | null = null;
    let planRecall: number | null = null;

    if (filesPlanned.length > 0 || allTouchedFiles.length > 0) {
      const plannedSet = new Set(filesPlanned);
      const touchedSet = new Set(allTouchedFiles);
      if (touchedSet.size > 0) {
        const touchedAndPlanned = allTouchedFiles.filter((f) =>
          plannedSet.has(f)
        ).length;
        planPrecision = Math.round(
          (touchedAndPlanned / touchedSet.size) * 100
        );
      }
      if (plannedSet.size > 0) {
        const plannedAndTouched = filesPlanned.filter((f) =>
          touchedSet.has(f)
        ).length;
        planRecall = Math.round(
          (plannedAndTouched / plannedSet.size) * 100
        );
      }
    }

    return {
      featureId: feature.id,
      featureTitle: feature.title,
      featureStatus: feature.status,
      workspaceId: feature.workspaceId,
      taskCount: feature.tasks.length,
      taskCompletionRate,
      totalMessages,
      totalCorrections,
      planPrecision,
      planRecall,
      filesPlanned,
      filesTouched: allTouchedFiles,
      tasks: taskMetrics,
    };
  });

  // Aggregate
  const allTasks = featureMetrics.flatMap((f) => f.tasks);
  const featureCount = featureMetrics.length;
  const taskCount = allTasks.length;

  const avgMessagesPerTask =
    taskCount > 0
      ? Math.round(
          (allTasks.reduce((s, t) => s + t.messageCount, 0) / taskCount) * 10
        ) / 10
      : 0;

  const ciTasks = allTasks.filter((t) => t.ciPassedFirstAttempt !== null);
  const ciPassRate =
    ciTasks.length > 0
      ? Math.round(
          (ciTasks.filter((t) => t.ciPassedFirstAttempt).length /
            ciTasks.length) *
            100
        )
      : 0;

  const precisionFeatures = featureMetrics.filter(
    (f) => f.planPrecision !== null
  );
  const recallFeatures = featureMetrics.filter(
    (f) => f.planRecall !== null
  );

  const avgPlanPrecision =
    precisionFeatures.length > 0
      ? Math.round(
          precisionFeatures.reduce((s, f) => s + f.planPrecision!, 0) /
            precisionFeatures.length
        )
      : 0;

  const avgPlanRecall =
    recallFeatures.length > 0
      ? Math.round(
          recallFeatures.reduce((s, f) => s + f.planRecall!, 0) /
            recallFeatures.length
        )
      : 0;

  const prTasks = allTasks.filter((t) => t.prStatus !== null);
  const prMergeRate =
    prTasks.length > 0
      ? Math.round(
          (prTasks.filter((t) => t.prStatus === "DONE").length /
            prTasks.length) *
            100
        )
      : 0;

  return {
    aggregate: {
      featureCount,
      avgMessagesPerTask,
      ciPassRate,
      avgPlanPrecision,
      avgPlanRecall,
      prMergeRate,
    },
    features: featureMetrics,
  };
}

// ---------------------------------------------------------------------------
// Single-feature metrics (used by session/digest/pipeline)
// ---------------------------------------------------------------------------

export async function computeFeatureMetrics(
  featureId: string
): Promise<FeatureMetrics> {
  const feature = await db.feature.findUniqueOrThrow({
    where: { id: featureId },
    select: { workspaceId: true },
  });

  const { features } = await computeMetricsBulk(feature.workspaceId);
  const match = features.find((f) => f.featureId === featureId);
  if (!match) {
    throw new Error(`Feature ${featureId} not found in metrics`);
  }
  return match;
}
