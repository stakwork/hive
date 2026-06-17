/**
 * getUserActivityFeed — shared service for querying a user's activity feed.
 *
 * Extracted from GET /api/profile/activity so that it can be reused as a
 * planner tool without duplicating the query logic.
 *
 * No cursor/pagination — callers get the top-N most recent items sorted
 * newest-first. The route uses this function and layers cursor pagination on
 * top.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ChatRole, Prisma } from "@prisma/client";

export interface ActivityItem {
  id: string;
  kind: "conversation" | "plan" | "task" | "milestone";
  category: "chat" | "plan" | "task" | "milestone";
  action: "created" | "active";
  title: string;
  link: string;
  workspaceName: string;
  orgName?: string;
  timestamp: string; // ISO
  completed: boolean;
}

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
// Internal fetch budget — always gather more than needed so de-duplication
// doesn't under-deliver. The tool enforces its own max=40 via Zod schema;
// the route enforces max=50 at the route layer. The service itself is
// cap-agnostic (it honours whatever limit the caller passes).
const QUERY_LIMIT = 100;

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.min(Math.max(value, MIN_DAYS), MAX_DAYS);
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  // Clamp to [MIN_LIMIT, QUERY_LIMIT] — callers (tool/route) apply their
  // own stricter upper bounds before calling.
  return Math.min(Math.max(value, MIN_LIMIT), QUERY_LIMIT);
}

interface PlanRow {
  featureId: string;
  title: string;
  workspaceId: string;
  deleted: boolean;
  lastMessageAt: Date;
  status: string;
}

interface TaskRow {
  taskId: string;
  title: string;
  workspaceId: string;
  lastMessageAt: Date;
  status: string;
}

export async function getUserActivityFeed(params: {
  userId: string;
  category?: "task" | "plan" | "chat" | "milestone" | null;
  q?: string;
  limit?: number;
  days?: number;
  /** Optional exclusive upper-bound timestamp for cursor-based pagination (used by route). */
  cursor?: Date | null;
}): Promise<ActivityItem[]> {
  const { userId, category = null, cursor = null } = params;

  const days = clampDays(params.days ?? DEFAULT_DAYS);
  const limit = clampLimit(params.limit ?? DEFAULT_LIMIT);
  const q = (params.q ?? "").trim();

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const runChat = !category || category === "chat";
  const runPlan = !category || category === "plan";
  const runTask = !category || category === "task";
  const runMilestone = !category || category === "milestone";

  // ── Time-window filter for Prisma ORM queries ────────────────────────────
  const timeFilter = cursor ? { gte: cutoff, lt: cursor } : { gte: cutoff };

  // ── Queries (run in parallel) ────────────────────────────────────────────
  const [
    conversationsResult,
    planChatResult,
    taskChatResult,
    createdTasksResult,
    createdFeaturesResult,
    milestonesResult,
  ] = await Promise.allSettled([
    // 1. SharedConversation rows (chat category)
    runChat
      ? db.sharedConversation.findMany({
          where: {
            userId,
            source: { in: ["dashboard", "org-canvas", "logs-agent"] },
            lastMessageAt: timeFilter,
            ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
          },
          select: {
            id: true,
            title: true,
            source: true,
            workspaceId: true,
            sourceControlOrgId: true,
            lastMessageAt: true,
          },
          orderBy: { lastMessageAt: "desc" },
          take: QUERY_LIMIT,
        })
      : Promise.resolve([]),

    // 2. Plan chat activity — GROUP BY featureId, latest timestamp
    runPlan
      ? db.$queryRaw<PlanRow[]>(
          Prisma.sql`
            SELECT
              cm.feature_id        AS "featureId",
              f.title              AS "title",
              f.workspace_id       AS "workspaceId",
              f.deleted            AS "deleted",
              f.status             AS "status",
              MAX(cm.timestamp)    AS "lastMessageAt"
            FROM chat_messages cm
            JOIN features f ON f.id = cm.feature_id
            WHERE cm.user_id = ${userId}
              AND cm.role = ${ChatRole.USER}::"ChatRole"
              AND cm.feature_id IS NOT NULL
              AND cm.timestamp >= ${cutoff}
              ${cursor ? Prisma.sql`AND cm.timestamp < ${cursor}` : Prisma.empty}
              AND f.deleted = false
              ${q ? Prisma.sql`AND f.title ILIKE ${"%" + q + "%"}` : Prisma.empty}
            GROUP BY cm.feature_id, f.title, f.workspace_id, f.deleted, f.status
            ORDER BY "lastMessageAt" DESC
            LIMIT ${QUERY_LIMIT}
          `,
        )
      : Promise.resolve([]),

    // 3. Task chat activity — GROUP BY taskId, latest timestamp
    runTask
      ? db.$queryRaw<TaskRow[]>(
          Prisma.sql`
            SELECT
              cm.task_id           AS "taskId",
              t.title              AS "title",
              t.workspace_id       AS "workspaceId",
              t.status             AS "status",
              MAX(cm.timestamp)    AS "lastMessageAt"
            FROM chat_messages cm
            JOIN tasks t ON t.id = cm.task_id
            WHERE cm.user_id = ${userId}
              AND cm.role = ${ChatRole.USER}::"ChatRole"
              AND cm.task_id IS NOT NULL
              AND cm.timestamp >= ${cutoff}
              ${cursor ? Prisma.sql`AND cm.timestamp < ${cursor}` : Prisma.empty}
              AND t.deleted = false
              AND t.archived = false
              ${q ? Prisma.sql`AND t.title ILIKE ${"%" + q + "%"}` : Prisma.empty}
            GROUP BY cm.task_id, t.title, t.workspace_id, t.status
            ORDER BY "lastMessageAt" DESC
            LIMIT ${QUERY_LIMIT}
          `,
        )
      : Promise.resolve([]),

    // 4. Tasks created by user
    runTask
      ? db.task.findMany({
          where: {
            createdById: userId,
            deleted: false,
            archived: false,
            createdAt: timeFilter,
            ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
          },
          select: {
            id: true,
            title: true,
            status: true,
            workspaceId: true,
            createdAt: true,
            workspace: {
              select: {
                slug: true,
                name: true,
                sourceControlOrg: { select: { githubLogin: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: QUERY_LIMIT,
        })
      : Promise.resolve([]),

    // 5. Features created by user
    runPlan
      ? db.feature.findMany({
          where: {
            createdById: userId,
            deleted: false,
            createdAt: timeFilter,
            ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
          },
          select: {
            id: true,
            title: true,
            status: true,
            workspaceId: true,
            createdAt: true,
            workspace: {
              select: {
                slug: true,
                name: true,
                sourceControlOrg: { select: { githubLogin: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: QUERY_LIMIT,
        })
      : Promise.resolve([]),

    // 6. Milestones assigned to or created by the user
    runMilestone
      ? db.milestone.findMany({
          where: {
            OR: [{ assigneeId: userId }, { createdById: userId }],
            updatedAt: timeFilter,
            ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
          },
          select: {
            id: true,
            name: true,
            status: true,
            assigneeId: true,
            createdById: true,
            updatedAt: true,
            initiative: {
              select: {
                id: true,
                org: { select: { githubLogin: true } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: QUERY_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  if (conversationsResult.status === "rejected") {
    logger.error("getUserActivityFeed: conversations query failed", "user-activity", {
      error: conversationsResult.reason,
    });
  }
  if (planChatResult.status === "rejected") {
    logger.error("getUserActivityFeed: plan chat query failed", "user-activity", {
      error: planChatResult.reason,
    });
  }
  if (taskChatResult.status === "rejected") {
    logger.error("getUserActivityFeed: task chat query failed", "user-activity", {
      error: taskChatResult.reason,
    });
  }
  if (createdTasksResult.status === "rejected") {
    logger.error("getUserActivityFeed: created tasks query failed", "user-activity", {
      error: createdTasksResult.reason,
    });
  }
  if (createdFeaturesResult.status === "rejected") {
    logger.error("getUserActivityFeed: created features query failed", "user-activity", {
      error: createdFeaturesResult.reason,
    });
  }
  if (milestonesResult.status === "rejected") {
    logger.error("getUserActivityFeed: milestone query failed", "user-activity", {
      error: milestonesResult.reason,
    });
  }

  const conversations =
    conversationsResult.status === "fulfilled" ? conversationsResult.value : [];
  const planRows = planChatResult.status === "fulfilled" ? planChatResult.value : [];
  const taskRows = taskChatResult.status === "fulfilled" ? taskChatResult.value : [];
  const createdTasks = createdTasksResult.status === "fulfilled" ? createdTasksResult.value : [];
  const createdFeatures =
    createdFeaturesResult.status === "fulfilled" ? createdFeaturesResult.value : [];
  const milestones = milestonesResult.status === "fulfilled" ? milestonesResult.value : [];

  // ── Batch-resolve workspace + org info for chat-sourced rows ─────────────
  const workspaceIds = new Set<string>();
  for (const c of conversations) {
    if (c.workspaceId) workspaceIds.add(c.workspaceId);
  }
  for (const p of planRows) workspaceIds.add(p.workspaceId);
  for (const t of taskRows) workspaceIds.add(t.workspaceId);

  const orgIds = new Set<string>();
  for (const c of conversations) {
    if (c.sourceControlOrgId) orgIds.add(c.sourceControlOrgId);
  }

  const [workspaces, orgs] = await Promise.all([
    workspaceIds.size > 0
      ? db.workspace.findMany({
          where: { id: { in: Array.from(workspaceIds) } },
          select: {
            id: true,
            slug: true,
            name: true,
            sourceControlOrg: { select: { githubLogin: true } },
          },
        })
      : Promise.resolve([]),
    orgIds.size > 0
      ? db.sourceControlOrg.findMany({
          where: { id: { in: Array.from(orgIds) } },
          select: { id: true, githubLogin: true },
        })
      : Promise.resolve([]),
  ]);

  const wsMap = new Map(
    workspaces.map((w) => [
      w.id,
      { slug: w.slug, name: w.name, githubLogin: w.sourceControlOrg?.githubLogin },
    ]),
  );
  const orgMap = new Map(orgs.map((o) => [o.id, o.githubLogin]));

  // ── Map to ActivityItem with de-duplication ───────────────────────────────
  const itemMap = new Map<string, ActivityItem>();

  function upsert(incoming: ActivityItem) {
    const existing = itemMap.get(incoming.id);
    if (!existing) {
      itemMap.set(incoming.id, incoming);
      return;
    }
    const latestTs =
      incoming.timestamp > existing.timestamp ? incoming.timestamp : existing.timestamp;
    const action: "active" | "created" =
      incoming.action === "active" || existing.action === "active" ? "active" : "created";
    const completed = incoming.completed || existing.completed;
    itemMap.set(incoming.id, { ...existing, timestamp: latestTs, action, completed });
  }

  // 1. Created tasks
  for (const t of createdTasks) {
    const ws = t.workspace;
    upsert({
      id: t.id,
      kind: "task",
      category: "task",
      action: "created",
      title: t.title ?? "Untitled task",
      link: ws ? `/w/${ws.slug}/task/${t.id}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.sourceControlOrg?.githubLogin,
      timestamp: t.createdAt.toISOString(),
      completed: t.status === "DONE" || t.status === "CANCELLED",
    });
  }

  // 2. Created features
  for (const f of createdFeatures) {
    const ws = f.workspace;
    upsert({
      id: f.id,
      kind: "plan",
      category: "plan",
      action: "created",
      title: f.title ?? "Untitled feature",
      link: ws ? `/w/${ws.slug}/plan/${f.id}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.sourceControlOrg?.githubLogin,
      timestamp: f.createdAt.toISOString(),
      completed: f.status === "COMPLETED" || f.status === "CANCELLED",
    });
  }

  // 3. Task chat activity
  for (const t of taskRows) {
    const ws = wsMap.get(t.workspaceId);
    upsert({
      id: t.taskId,
      kind: "task",
      category: "task",
      action: "active",
      title: t.title ?? "Untitled task",
      link: ws ? `/w/${ws.slug}/task/${t.taskId}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.githubLogin,
      timestamp: new Date(t.lastMessageAt).toISOString(),
      completed: t.status === "DONE" || t.status === "CANCELLED",
    });
  }

  // 4. Plan chat activity
  for (const p of planRows) {
    const ws = wsMap.get(p.workspaceId);
    upsert({
      id: p.featureId,
      kind: "plan",
      category: "plan",
      action: "active",
      title: p.title ?? "Untitled feature",
      link: ws ? `/w/${ws.slug}/plan/${p.featureId}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.githubLogin,
      timestamp: new Date(p.lastMessageAt).toISOString(),
      completed: p.status === "COMPLETED" || p.status === "CANCELLED",
    });
  }

  // 5. Milestones
  for (const m of milestones) {
    const githubLogin = m.initiative?.org?.githubLogin;
    const initiativeId = m.initiative?.id;
    const link =
      githubLogin && initiativeId
        ? `/org/${githubLogin}?canvas=initiative:${initiativeId}`
        : githubLogin
          ? `/org/${githubLogin}`
          : "#";
    upsert({
      id: m.id,
      kind: "milestone",
      category: "milestone",
      action: m.createdById === userId ? "created" : "active",
      title: m.name,
      link,
      workspaceName: "",
      orgName: githubLogin,
      timestamp: m.updatedAt.toISOString(),
      completed: m.status === "COMPLETED",
    });
  }

  // 6. Conversations
  for (const c of conversations) {
    const timestamp = c.lastMessageAt?.toISOString();
    if (!timestamp) continue;

    let link = "#";
    let workspaceName = "";
    let orgName: string | undefined;

    if (c.source === "org-canvas") {
      const githubLogin = c.sourceControlOrgId ? orgMap.get(c.sourceControlOrgId) : undefined;
      if (githubLogin) {
        link = `/org/${githubLogin}?chat=${c.id}`;
        orgName = githubLogin;
      }
    } else if (c.workspaceId) {
      const ws = wsMap.get(c.workspaceId);
      if (ws) {
        workspaceName = ws.name;
        orgName = ws.githubLogin;
        if (c.source === "dashboard") {
          link = `/w/${ws.slug}?chat=${c.id}`;
        } else if (c.source === "logs-agent") {
          link = `/w/${ws.slug}/agent-logs/chat/${c.id}`;
        }
      }
    }

    upsert({
      id: c.id,
      kind: "conversation",
      category: "chat",
      action: "active",
      title: c.title ?? "Untitled conversation",
      link,
      workspaceName,
      orgName,
      timestamp,
      completed: false,
    });
  }

  // ── Sort DESC + slice ────────────────────────────────────────────────────
  return Array.from(itemMap.values())
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, limit);
}
