/**
 * GET /api/profile/activity
 *
 * Returns a unified reverse-chronological feed of the authenticated user's
 * recent activity across all orgs and workspaces:
 *   - SharedConversation rows (dashboard / org-canvas / logs-agent)
 *   - ChatMessage rows with featureId → plan chat activity (deduplicated per feature)
 *   - ChatMessage rows with taskId → task chat activity (deduplicated per task)
 *   - Tasks created by the user
 *   - Features created by the user
 *
 * Query params:
 *   days     — integer 1–30, default 30 (clamped to range)
 *   cursor   — ISO timestamp string; exclusive upper bound for pagination
 *   limit    — integer 1–50, default 20
 *   category — "task" | "plan" | "chat"; omit = all
 *   q        — title search (case-insensitive contains); empty/whitespace = no-op
 *
 * Returns { items: ActivityItem[], nextCursor: string | null }.
 *
 * NOTE: To exercise the created-by paths locally, ensure the dev/session user
 * has created Tasks and Features via the UI (beyond just chatted-in ones).
 * No seed script exists; create items through the normal Hive UI flows.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ChatRole, Prisma } from "@prisma/client";

export interface ActivityItem {
  id: string;
  kind: "conversation" | "plan" | "task";
  category: "chat" | "plan" | "task";
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
const MAX_LIMIT = 50;
const QUERY_LIMIT = 100; // fetch more than needed so we can de-dupe then paginate

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.min(Math.max(value, MIN_DAYS), MAX_DAYS);
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(value, MIN_LIMIT), MAX_LIMIT);
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

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const userId = userOrResponse.id;

  const params = request.nextUrl.searchParams;
  const daysParam = params.get("days");
  const days = clampDays(daysParam ? Number.parseInt(daysParam, 10) : DEFAULT_DAYS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const cursorParam = params.get("cursor");
  const cursor = cursorParam ? new Date(cursorParam) : null;

  const limitParam = params.get("limit");
  const limit = clampLimit(limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT);

  const categoryParam = params.get("category");
  const category =
    categoryParam === "task" || categoryParam === "plan" || categoryParam === "chat"
      ? categoryParam
      : null;

  const qRaw = params.get("q") ?? "";
  const q = qRaw.trim();

  // Determine which queries to run based on category filter
  const runChat = !category || category === "chat";
  const runPlan = !category || category === "plan";
  const runTask = !category || category === "task";

  // ── Time-window filter for Prisma ORM queries ─────────────────────────────
  const timeFilter = cursor
    ? { gte: cutoff, lt: cursor }
    : { gte: cutoff };

  // ── Queries (run in parallel) ──────────────────────────────────────────────
  const [
    conversationsResult,
    planChatResult,
    taskChatResult,
    createdTasksResult,
    createdFeaturesResult,
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
  ]);

  if (conversationsResult.status === "rejected") {
    logger.error("profile/activity: conversations query failed", "profile/activity", {
      error: conversationsResult.reason,
    });
  }
  if (planChatResult.status === "rejected") {
    logger.error("profile/activity: plan chat query failed", "profile/activity", {
      error: planChatResult.reason,
    });
  }
  if (taskChatResult.status === "rejected") {
    logger.error("profile/activity: task chat query failed", "profile/activity", {
      error: taskChatResult.reason,
    });
  }
  if (createdTasksResult.status === "rejected") {
    logger.error("profile/activity: created tasks query failed", "profile/activity", {
      error: createdTasksResult.reason,
    });
  }
  if (createdFeaturesResult.status === "rejected") {
    logger.error("profile/activity: created features query failed", "profile/activity", {
      error: createdFeaturesResult.reason,
    });
  }

  const conversations =
    conversationsResult.status === "fulfilled" ? conversationsResult.value : [];
  const planRows = planChatResult.status === "fulfilled" ? planChatResult.value : [];
  const taskRows = taskChatResult.status === "fulfilled" ? taskChatResult.value : [];
  const createdTasks = createdTasksResult.status === "fulfilled" ? createdTasksResult.value : [];
  const createdFeatures =
    createdFeaturesResult.status === "fulfilled" ? createdFeaturesResult.value : [];

  // ── Batch-resolve workspace + org info for chat-sourced rows ───────────────
  // (created-by queries already embed workspace via Prisma include)
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

  // ── Map to ActivityItem with de-duplication ────────────────────────────────
  // We use a Map<id, ActivityItem> for de-duplication.
  // - If an entity appears in both created-by and chat-activity results, keep
  //   a single item using the most-recent timestamp.
  // - action = "active" if there has been any chat activity; "created" otherwise.
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

  // 1. Created tasks (may be overridden/merged by chat activity below)
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

  // 2. Created features (may be overridden/merged by plan chat below)
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

  // 3. Task chat activity (marks action as "active")
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

  // 4. Plan chat activity (marks action as "active")
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

  // 5. Conversations (always chat category / action: "active")
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

  // ── Sort DESC + paginate ──────────────────────────────────────────────────
  const sorted = Array.from(itemMap.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
  );

  const page = sorted.slice(0, limit);
  const nextCursor = page.length === limit ? page[page.length - 1].timestamp : null;

  return NextResponse.json({ items: page, nextCursor });
}
