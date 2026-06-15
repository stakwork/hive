import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface StalePRTask {
  taskId: string;
  taskTitle: string;
  prUrl: string;
  state: "ci_failure" | "conflict";
  repoUrl: string;
  stuckSinceDays: number;
  artifactId: string;
  workspaceId: string;
}

export interface FindStalePRTasksOptions {
  /** undefined = all workspaces */
  workspaceId?: string;
  /** optional repo filter */
  repoUrl?: string;
  /** default 7 */
  thresholdDays: number;
  /** bypass threshold/state filter for by-ID mode */
  taskIds?: string[];
}

/**
 * Find tasks whose PRs are stuck in ci_failure or conflict state
 * beyond the configured threshold, or find specific tasks by ID.
 */
export async function findStalePRTasks(opts: FindStalePRTasksOptions): Promise<StalePRTask[]> {
  const { workspaceId, repoUrl, thresholdDays, taskIds } = opts;

  if (taskIds && taskIds.length === 0) {
    return [];
  }

  // Build conditional SQL fragments
  const workspaceFilter = workspaceId
    ? Prisma.sql`AND t.workspace_id = ${workspaceId}`
    : Prisma.empty;

  const repoFilter = repoUrl
    ? Prisma.sql`AND a.content->>'url' LIKE ${repoUrl + "%"}`
    : Prisma.empty;

  // When taskIds provided: skip state/threshold filter, use ID filter instead
  const stateFilter = taskIds
    ? Prisma.sql`AND t.id = ANY(${taskIds})`
    : Prisma.sql`
        AND a.content->'progress'->>'state' IN ('ci_failure', 'conflict')
        AND (a.content->'progress'->>'lastCheckedAt') IS NOT NULL
        AND (a.content->'progress'->>'lastCheckedAt')::timestamptz < NOW() - INTERVAL '1 day' * ${thresholdDays}
      `;

  const rows = await db.$queryRaw<
    Array<{
      artifact_id: string;
      task_id: string;
      task_title: string;
      pr_url: string;
      state: string;
      repo_url: string;
      stuck_since_days: number;
      workspace_id: string;
    }>
  >`
    SELECT DISTINCT ON (a.content->>'url')
      a.id                                                                      AS artifact_id,
      t.id                                                                      AS task_id,
      t.title                                                                   AS task_title,
      a.content->>'url'                                                         AS pr_url,
      a.content->'progress'->>'state'                                           AS state,
      COALESCE(a.content->>'repoUrl', '')                                       AS repo_url,
      EXTRACT(
        EPOCH FROM (
          NOW() - (a.content->'progress'->>'lastCheckedAt')::timestamptz
        )
      ) / 86400                                                                 AS stuck_since_days,
      t.workspace_id                                                            AS workspace_id
    FROM artifacts a
    JOIN chat_messages m ON a.message_id = m.id
    JOIN tasks t         ON m.task_id    = t.id
    WHERE
      a.type          = 'PULL_REQUEST'
      AND t.deleted   = false
      AND t.archived  = false
      AND COALESCE(a.content->>'status', 'open') NOT IN ('DONE', 'CANCELLED')
      ${stateFilter}
      ${workspaceFilter}
      ${repoFilter}
    ORDER BY a.content->>'url', a.created_at DESC
  `;

  return rows.map((r) => ({
    taskId: r.task_id,
    taskTitle: r.task_title,
    prUrl: r.pr_url,
    state: r.state as "ci_failure" | "conflict",
    repoUrl: r.repo_url,
    stuckSinceDays: Number(r.stuck_since_days),
    artifactId: r.artifact_id,
    workspaceId: r.workspace_id,
  }));
}

/**
 * Archive tasks that are permanently stuck in CI failure or merge conflict state.
 * Marks the tasks as archived and sets the PR artifact status to CANCELLED
 * so findOpenPRArtifacts stops picking them up in the next cron cycle.
 */
export async function archiveStalePRTasks(
  tasks: Array<{ taskId: string; artifactId: string }>,
): Promise<{ archivedCount: number }> {
  if (tasks.length === 0) {
    return { archivedCount: 0 };
  }

  const taskIds = tasks.map((t) => t.taskId);
  const artifactIds = tasks.map((t) => t.artifactId);

  const [updateResult] = await Promise.all([
    db.task.updateMany({
      where: { id: { in: taskIds } },
      data: { archived: true, archivedAt: new Date() },
    }),
    db.$executeRaw`
      UPDATE artifacts
      SET content = jsonb_set(content, '{status}', '"CANCELLED"')
      WHERE id = ANY(${artifactIds})
    `,
  ]);

  return { archivedCount: updateResult.count };
}
