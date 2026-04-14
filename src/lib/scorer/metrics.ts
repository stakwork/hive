/**
 * Layer 1: Automated Metrics
 *
 * Pure computation from existing DB data. No LLM calls.
 * Computes per-task, per-feature, and aggregate metrics.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Affirmation filter for correction counting
// ---------------------------------------------------------------------------

const AFFIRMATIONS = new Set([
  "yes",
  "ok",
  "y",
  "go",
  "sure",
  "do it",
  "looks good",
  "proceed",
  "continue",
  "approved",
  "lgtm",
  "next",
  "go ahead",
  "yep",
  "yup",
  "yeah",
  "correct",
  "right",
  "perfect",
  "great",
  "good",
  "fine",
  "agreed",
  "confirmed",
  "ship it",
  "merge it",
  "thanks",
  "thank you",
  "cool",
  "nice",
  "done",
  "k",
  "okay",
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
  prStatus: string | null; // "DONE" | "CANCELLED" | "OPEN" | null
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
  taskCompletionRate: number; // % of tasks with merged PRs
  totalMessages: number;
  totalCorrections: number;
  planPrecision: number | null; // % of touched files that were planned
  planRecall: number | null; // % of planned files that were touched
  filesPlanned: string[];
  filesTouched: string[];
  tasks: TaskMetrics[];
}

export interface AggregateMetrics {
  featureCount: number;
  avgMessagesPerTask: number;
  ciPassRate: number; // %
  avgPlanPrecision: number; // %
  avgPlanRecall: number; // %
  prMergeRate: number; // %
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
// Extract files from DIFF artifacts
// ---------------------------------------------------------------------------

interface DiffActionResult {
  file?: string;
  action?: string;
  repoName?: string;
}

function extractFilesFromDiffs(
  artifacts: Array<{ content: unknown }>
): FileAction[] {
  const fileMap = new Map<string, string>();
  for (const artifact of artifacts) {
    const content = artifact.content;
    if (!content || !Array.isArray(content)) continue;
    for (const item of content as DiffActionResult[]) {
      if (item.file) {
        fileMap.set(item.file, item.action || "modify");
      }
    }
  }
  return Array.from(fileMap.entries()).map(([file, action]) => ({
    file,
    action,
  }));
}

// ---------------------------------------------------------------------------
// Extract PR info from PULL_REQUEST artifacts
// ---------------------------------------------------------------------------

interface PrArtifactContent {
  url?: string;
  status?: string;
  repo?: string;
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
// Compute per-task metrics
// ---------------------------------------------------------------------------

export async function computeTaskMetrics(taskId: string): Promise<TaskMetrics> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
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
  });

  // Message count = all USER messages
  const messageCount = task.chatMessages.length;

  // Correction count = USER messages after initial, minus affirmations
  const corrections =
    messageCount <= 1
      ? 0
      : task.chatMessages.slice(1).filter((m) => !isAffirmation(m.message))
          .length;

  // Artifacts: DIFF + PULL_REQUEST
  const artifacts = await db.artifact.findMany({
    where: {
      message: { taskId },
    },
    select: { type: true, content: true },
  });

  const diffArtifacts = artifacts.filter((a) => a.type === "DIFF");
  const prArtifacts = artifacts.filter((a) => a.type === "PULL_REQUEST");

  const filesTouched = extractFilesFromDiffs(diffArtifacts);
  const prInfo = extractPrInfo(prArtifacts);

  // CI: check if first PR artifact had passing CI (heuristic: status became DONE without retry)
  // We simplify: ciPassedFirstAttempt is true if PR is DONE and haltRetryAttempted is false
  const ciPassedFirstAttempt =
    prInfo.status === "DONE" ? !task.haltRetryAttempted : null;

  // Duration
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
    correctionCount: corrections,
    ciPassedFirstAttempt,
    prStatus: prInfo.status,
    prUrl: prInfo.url,
    durationMinutes,
    haltRetryAttempted: task.haltRetryAttempted,
    filesTouched,
  };
}

// ---------------------------------------------------------------------------
// Compute per-feature metrics
// ---------------------------------------------------------------------------

export async function computeFeatureMetrics(
  featureId: string
): Promise<FeatureMetrics> {
  const feature = await db.feature.findUniqueOrThrow({
    where: { id: featureId },
    select: {
      id: true,
      title: true,
      status: true,
      workspaceId: true,
      architecture: true,
      tasks: {
        where: { deleted: false },
        select: { id: true },
        orderBy: { order: "asc" },
      },
    },
  });

  const taskMetrics = await Promise.all(
    feature.tasks.map((t) => computeTaskMetrics(t.id))
  );

  const totalMessages = taskMetrics.reduce(
    (sum, t) => sum + t.messageCount,
    0
  );
  const totalCorrections = taskMetrics.reduce(
    (sum, t) => sum + t.correctionCount,
    0
  );

  // Task completion rate: tasks with merged PRs / total tasks
  const mergedCount = taskMetrics.filter(
    (t) => t.prStatus === "DONE"
  ).length;
  const taskCompletionRate =
    feature.tasks.length > 0
      ? Math.round((mergedCount / feature.tasks.length) * 100)
      : 0;

  // Plan precision/recall
  const filesPlanned = extractFilePaths(feature.architecture);
  const allTouchedFiles = [
    ...new Set(taskMetrics.flatMap((t) => t.filesTouched.map((f) => f.file))),
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
      planPrecision = Math.round((touchedAndPlanned / touchedSet.size) * 100);
    }
    if (plannedSet.size > 0) {
      const plannedAndTouched = filesPlanned.filter((f) =>
        touchedSet.has(f)
      ).length;
      planRecall = Math.round((plannedAndTouched / plannedSet.size) * 100);
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
}

// ---------------------------------------------------------------------------
// Compute aggregate metrics for a workspace
// ---------------------------------------------------------------------------

export async function computeAggregateMetrics(
  workspaceId: string,
  since?: Date
): Promise<{ aggregate: AggregateMetrics; features: FeatureMetrics[] }> {
  const dateFilter = since ? { createdAt: { gte: since } } : {};

  const features = await db.feature.findMany({
    where: { workspaceId, deleted: false, ...dateFilter },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  const featureMetrics = await Promise.all(
    features.map((f) => computeFeatureMetrics(f.id))
  );

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
  const recallFeatures = featureMetrics.filter((f) => f.planRecall !== null);

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
