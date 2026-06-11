/**
 * GET /api/profile/activity?days=N
 *
 * Returns a unified reverse-chronological feed of the authenticated user's
 * recent activity across all orgs and workspaces:
 *   - SharedConversation rows (dashboard / org-canvas / logs-agent)
 *   - ChatMessage rows with featureId → plan chat activity (deduplicated per feature)
 *   - ChatMessage rows with taskId → task chat activity (deduplicated per task)
 *
 * Query params:
 *   days — integer 1–30, default 30 (clamped to range)
 *
 * Returns { items: ActivityItem[] }, sorted by timestamp DESC, max 50 items.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ChatRole } from "@prisma/client";

export interface ActivityItem {
  id: string;
  kind: "conversation" | "plan" | "task";
  title: string;
  link: string;
  workspaceName: string;
  orgName?: string;
  timestamp: string; // ISO
}

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const MAX_RESULTS = 50;
const QUERY_LIMIT = 25;

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.min(Math.max(value, MIN_DAYS), MAX_DAYS);
}

interface PlanRow {
  featureId: string;
  title: string;
  workspaceId: string;
  deleted: boolean;
  lastMessageAt: Date;
}

interface TaskRow {
  taskId: string;
  title: string;
  workspaceId: string;
  lastMessageAt: Date;
}

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const userId = userOrResponse.id;

  const daysParam = request.nextUrl.searchParams.get("days");
  const days = clampDays(daysParam ? Number.parseInt(daysParam, 10) : DEFAULT_DAYS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ── Three parallel queries ─────────────────────────────────────────────────
  const [conversationsResult, planResult, taskResult] = await Promise.allSettled([
    // 1. SharedConversation rows
    db.sharedConversation.findMany({
      where: {
        userId,
        source: { in: ["dashboard", "org-canvas", "logs-agent"] },
        lastMessageAt: { gte: cutoff },
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
    }),

    // 2. Plan chat activity — GROUP BY featureId, latest timestamp
    db.$queryRaw<PlanRow[]>`
      SELECT
        cm.feature_id        AS "featureId",
        f.title              AS "title",
        f.workspace_id       AS "workspaceId",
        f.deleted            AS "deleted",
        MAX(cm.timestamp)    AS "lastMessageAt"
      FROM chat_messages cm
      JOIN features f ON f.id = cm.feature_id
      WHERE cm.user_id = ${userId}
        AND cm.role = ${ChatRole.USER}::"ChatRole"
        AND cm.feature_id IS NOT NULL
        AND cm.timestamp >= ${cutoff}
        AND f.deleted = false
      GROUP BY cm.feature_id, f.title, f.workspace_id, f.deleted
      ORDER BY "lastMessageAt" DESC
      LIMIT ${QUERY_LIMIT}
    `,

    // 3. Task chat activity — GROUP BY taskId, latest timestamp
    db.$queryRaw<TaskRow[]>`
      SELECT
        cm.task_id           AS "taskId",
        t.title              AS "title",
        t.workspace_id       AS "workspaceId",
        MAX(cm.timestamp)    AS "lastMessageAt"
      FROM chat_messages cm
      JOIN tasks t ON t.id = cm.task_id
      WHERE cm.user_id = ${userId}
        AND cm.role = ${ChatRole.USER}::"ChatRole"
        AND cm.task_id IS NOT NULL
        AND cm.timestamp >= ${cutoff}
        AND t.deleted = false
        AND t.archived = false
      GROUP BY cm.task_id, t.title, t.workspace_id
      ORDER BY "lastMessageAt" DESC
      LIMIT ${QUERY_LIMIT}
    `,
  ]);

  if (conversationsResult.status === "rejected") {
    logger.error("profile/activity: conversations query failed", "profile/activity", {
      error: conversationsResult.reason,
    });
  }
  if (planResult.status === "rejected") {
    logger.error("profile/activity: plan query failed", "profile/activity", { error: planResult.reason });
  }
  if (taskResult.status === "rejected") {
    logger.error("profile/activity: task query failed", "profile/activity", { error: taskResult.reason });
  }

  const conversations =
    conversationsResult.status === "fulfilled" ? conversationsResult.value : [];
  const planRows = planResult.status === "fulfilled" ? planResult.value : [];
  const taskRows = taskResult.status === "fulfilled" ? taskResult.value : [];

  // ── Batch-resolve workspace + org info ─────────────────────────────────────
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

  // ── Map to ActivityItem ────────────────────────────────────────────────────
  const items: ActivityItem[] = [];

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

    items.push({
      id: c.id,
      kind: "conversation",
      title: c.title ?? "Untitled conversation",
      link,
      workspaceName,
      orgName,
      timestamp,
    });
  }

  for (const p of planRows) {
    const ws = wsMap.get(p.workspaceId);
    items.push({
      id: p.featureId,
      kind: "plan",
      title: p.title ?? "Untitled feature",
      link: ws ? `/w/${ws.slug}/plan/${p.featureId}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.githubLogin,
      timestamp: new Date(p.lastMessageAt).toISOString(),
    });
  }

  for (const t of taskRows) {
    const ws = wsMap.get(t.workspaceId);
    items.push({
      id: t.taskId,
      kind: "task",
      title: t.title ?? "Untitled task",
      link: ws ? `/w/${ws.slug}/task/${t.taskId}` : "#",
      workspaceName: ws?.name ?? "",
      orgName: ws?.githubLogin,
      timestamp: new Date(t.lastMessageAt).toISOString(),
    });
  }

  // ── Sort DESC + slice ─────────────────────────────────────────────────────
  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  const result = items.slice(0, MAX_RESULTS);

  return NextResponse.json({ items: result });
}
