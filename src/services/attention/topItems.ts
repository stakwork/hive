/**
 * Top items needing the user's attention — multi-workspace aggregator
 * that powers the synthetic intro message in the org canvas chat.
 *
 * Four signals (ranked by surfacing order):
 *
 *   1. **halted**          — Task or Feature with `workflowStatus IN
 *                            (HALTED, FAILED, ERROR)`, owned by user.
 *                            Stuck workflows that cannot self-recover.
 *   2. **awaiting-reply**  — Feature whose last `ChatMessage.role` is
 *                            ASSISTANT and has no tasks. Adapted from
 *                            `services/roadmap/features.ts:92` (the
 *                            same query that powers the dashboard
 *                            bell widget).
 *   3. **plan-question**   — Task with `workflowStatus IN (PENDING,
 *                            IN_PROGRESS)` whose latest chat message
 *                            has a FORM artifact. Adapted from the
 *                            existing `tasks/notifications-count`
 *                            endpoint.
 *   4. **ready-to-review** — Task or Feature with `workflowStatus =
 *                            COMPLETED`, owned by user. Agent finished;
 *                            user must accept/reject. This is what
 *                            `mcpCheckStatus` calls "needs attention."
 *
 * Ownership = user is `createdById` OR `assigneeId`. Items are
 * deduplicated by `entityKind:entityId` — if a task appears in
 * multiple buckets only its highest-priority instance survives. Cap
 * is applied last.
 *
 * Why a separate service rather than reusing `fetchStatusItems` from
 * `src/lib/mcp/mcpTools.ts`: that function is single-workspace,
 * scoped to the agent's `check_status` tool, and conflates "halted"
 * + "completed" under a single `needsAttention` boolean. We need
 * multi-workspace fan-out, finer-grained signal types so the UI can
 * pick icons/copy per type, and freedom to add the FORM and
 * awaiting-reply signals (which are not in `fetchStatusItems`).
 */
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { Priority, WorkflowStatus } from "@prisma/client";

/** A single item in the top-attention list. */
export interface AttentionItem {
  id: string;
  type: "halted" | "awaiting-reply" | "plan-question" | "ready-to-review";
  title: string;
  workspaceSlug: string;
  workspaceName: string;
  entityKind: "task" | "feature";
  entityId: string;
  /**
   * Workspace-scoped fallback URL for entities that don't project on
   * any canvas (typically tasks whose parent feature has no milestone).
   * The AttentionList click handler uses this only when an in-canvas
   * navigation isn't possible.
   */
  link: string;
  /** Wall-clock age of the most-recent triggering event (ms). */
  ageMs: number;
  priority?: Priority;
  workflowStatus?: WorkflowStatus | null;

  // ── Canvas-projection fields ──────────────────────────────────────
  // Together with `entityKind` + `entityId`, these let the client
  // compute the canvas ref the entity projects on — see
  // `mostSpecificRef` in `src/lib/canvas/feature-projection.ts`.
  // Features anchored to an initiative (with or without a milestone)
  // land on `initiative:<id>`; loose features land on `ws:<id>`.
  // None of these have to round-trip through a JSON blob: the ref is
  // purely a function of these relational FKs.
  /** Workspace the entity belongs to. Always present. */
  workspaceId: string;
  /** Feature: own initiativeId. Task: parent feature's initiativeId. */
  initiativeId?: string | null;
  /** Feature: own milestoneId. Task: parent feature's milestoneId. */
  milestoneId?: string | null;
  /** Tasks only: parent feature id (null for tasks not linked to a feature). */
  featureId?: string | null;
}

/** Workspaces accessible to the user inside this org. */
interface Workspace {
  id: string;
  slug: string;
  name: string;
}

const HALTED_STATUSES: WorkflowStatus[] = ["HALTED", "FAILED", "ERROR"];
const PLAN_QUESTION_STATUSES: WorkflowStatus[] = ["PENDING", "IN_PROGRESS"];
const READY_REVIEW_STATUSES: WorkflowStatus[] = ["COMPLETED"];

/** Type-bucket order — earlier buckets win on dedupe + sort ties. */
const TYPE_ORDER: Record<AttentionItem["type"], number> = {
  halted: 0,
  "awaiting-reply": 1,
  "plan-question": 2,
  "ready-to-review": 3,
};

/**
 * Resolve the workspaces inside `githubLogin` that `userId` can see.
 * Mirrors `/api/orgs/[githubLogin]/workspaces` (which already does
 * exactly this) so the attention aggregator scopes to the same set.
 *
 * When `allowedSlugs` is provided, the result is further restricted
 * to only those slugs — used by the canvas caller to exclude
 * workspaces the user has hidden on the root canvas (a hidden
 * workspace shouldn't surface attention items in the intro card).
 * `null` / `undefined` means "no slug filter."
 */
async function getAccessibleWorkspaces(
  githubLogin: string,
  userId: string,
  allowedSlugs?: string[] | null,
): Promise<Workspace[]> {
  // Empty array means the caller explicitly told us "no workspaces
  // are visible" — short-circuit before hitting the DB.
  if (allowedSlugs && allowedSlugs.length === 0) return [];
  const rows = await db.workspace.findMany({
    where: {
      deleted: false,
      sourceControlOrg: { githubLogin },
      OR: [
        { ownerId: userId },
        { members: { some: { userId, leftAt: null } } },
      ],
      ...(allowedSlugs ? { slug: { in: allowedSlugs } } : {}),
    },
    select: { id: true, slug: true, name: true },
  });
  return rows;
}

/**
 * Collect halted/failed/errored items owned by the user across
 * `workspaces`. Returns one `AttentionItem` per row.
 */
async function fetchHalted(
  workspaces: Workspace[],
  userId: string,
): Promise<AttentionItem[]> {
  if (workspaces.length === 0) return [];
  const wsIds = workspaces.map((w) => w.id);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  const userFilter = {
    OR: [{ createdById: userId }, { assigneeId: userId }],
  };

  const [tasks, features] = await Promise.all([
    db.task.findMany({
      where: {
        workspaceId: { in: wsIds },
        deleted: false,
        archived: false,
        workflowStatus: { in: HALTED_STATUSES },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        workspaceId: true,
        featureId: true,
        // Pull the parent feature's projection triple — tasks project
        // on the milestone canvas of their parent feature (`projectors.ts`
        // emits one `task:<id>` node under each parent feature column on
        // milestone canvases). Without milestone, the task isn't on any
        // canvas → fallback URL.
        feature: {
          select: { initiativeId: true, milestoneId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    db.feature.findMany({
      where: {
        workspaceId: { in: wsIds },
        deleted: false,
        workflowStatus: { in: HALTED_STATUSES },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        workspaceId: true,
        initiativeId: true,
        milestoneId: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
  ]);

  const now = Date.now();
  const taskItems: AttentionItem[] = tasks.map((t) => {
    const ws = wsById.get(t.workspaceId)!;
    return {
      id: `halted:task:${t.id}`,
      type: "halted",
      title: t.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "task",
      entityId: t.id,
      link: `/w/${ws.slug}/task/${t.id}`,
      ageMs: Math.max(0, now - t.updatedAt.getTime()),
      priority: t.priority as Priority,
      workflowStatus: t.workflowStatus,
      workspaceId: t.workspaceId,
      featureId: t.featureId,
      initiativeId: t.feature?.initiativeId ?? null,
      milestoneId: t.feature?.milestoneId ?? null,
    };
  });
  const featureItems: AttentionItem[] = features.map((f) => {
    const ws = wsById.get(f.workspaceId)!;
    return {
      id: `halted:feature:${f.id}`,
      type: "halted",
      title: f.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "feature",
      entityId: f.id,
      link: `/w/${ws.slug}/plan/${f.id}`,
      ageMs: Math.max(0, now - f.updatedAt.getTime()),
      priority: f.priority as Priority,
      workflowStatus: f.workflowStatus,
      workspaceId: f.workspaceId,
      initiativeId: f.initiativeId,
      milestoneId: f.milestoneId,
    };
  });

  return [...taskItems, ...featureItems];
}

/**
 * Features awaiting user feedback — last chat message ASSISTANT and
 * no tasks have been spawned yet. Adapted from
 * `services/roadmap/features.ts:92`. Scoped per workspace so we can
 * tag each row with the workspace it belongs to.
 */
async function fetchAwaitingReply(
  workspaces: Workspace[],
  userId: string,
): Promise<AttentionItem[]> {
  if (workspaces.length === 0) return [];
  const wsIds = workspaces.map((w) => w.id);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  // Raw SQL: features whose latest chat message role is ASSISTANT,
  // have no tasks, owned by user (assignee or creator). Returns
  // workspace_id so we can tag the workspace label without a second
  // query.
  const rows = await db.$queryRaw<
    {
      id: string;
      title: string;
      priority: string;
      updated_at: Date;
      workspace_id: string;
      initiative_id: string | null;
      milestone_id: string | null;
    }[]
  >(Prisma.sql`
    SELECT f.id, f.title, f.priority, f.updated_at, f.workspace_id,
           f.initiative_id, f.milestone_id
    FROM features f
    WHERE f.workspace_id IN (${Prisma.join(wsIds)})
      AND f.deleted = false
      AND (f.assignee_id = ${userId} OR f.created_by_id = ${userId})
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.feature_id = f.id
          AND t.deleted = false
          AND t.archived = false
      )
      AND (
        SELECT role FROM chat_messages cm
        WHERE cm.feature_id = f.id
        ORDER BY cm.timestamp DESC LIMIT 1
      ) = 'ASSISTANT'::"ChatRole"
    ORDER BY f.updated_at DESC
    LIMIT 25
  `);

  const now = Date.now();
  return rows.map((r) => {
    const ws = wsById.get(r.workspace_id)!;
    return {
      id: `awaiting:feature:${r.id}`,
      type: "awaiting-reply",
      title: r.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "feature",
      entityId: r.id,
      link: `/w/${ws.slug}/plan/${r.id}`,
      ageMs: Math.max(0, now - r.updated_at.getTime()),
      priority: r.priority as Priority,
      workspaceId: r.workspace_id,
      initiativeId: r.initiative_id,
      milestoneId: r.milestone_id,
    };
  });
}

/**
 * Tasks whose latest chat message has a FORM artifact — agent asked
 * a clarifying question, user hasn't replied. Filtered to PENDING /
 * IN_PROGRESS workflow status to mirror
 * `tasks/notifications-count/route.ts:60`.
 */
async function fetchPlanQuestions(
  workspaces: Workspace[],
  userId: string,
): Promise<AttentionItem[]> {
  if (workspaces.length === 0) return [];
  const wsIds = workspaces.map((w) => w.id);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  const candidates = await db.task.findMany({
    where: {
      workspaceId: { in: wsIds },
      deleted: false,
      archived: false,
      workflowStatus: { in: PLAN_QUESTION_STATUSES },
      OR: [
        { createdById: userId },
        { assigneeId: userId },
      ],
    },
    select: {
      id: true,
      title: true,
      priority: true,
      updatedAt: true,
      workspaceId: true,
      featureId: true,
      feature: {
        select: { initiativeId: true, milestoneId: true },
      },
      chatMessages: {
        orderBy: { timestamp: "desc" },
        take: 1,
        select: {
          timestamp: true,
          artifacts: { select: { type: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const now = Date.now();
  const items: AttentionItem[] = [];
  for (const t of candidates) {
    const last = t.chatMessages[0];
    if (!last) continue;
    const hasForm = last.artifacts.some((a) => a.type === "FORM");
    if (!hasForm) continue;
    const ws = wsById.get(t.workspaceId)!;
    items.push({
      id: `form:task:${t.id}`,
      type: "plan-question",
      title: t.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "task",
      entityId: t.id,
      link: `/w/${ws.slug}/task/${t.id}`,
      // Use the chat message timestamp as the age — that's when the
      // question was actually posed, not when the task was last
      // touched.
      ageMs: Math.max(0, now - last.timestamp.getTime()),
      priority: t.priority as Priority,
      workspaceId: t.workspaceId,
      featureId: t.featureId,
      initiativeId: t.feature?.initiativeId ?? null,
      milestoneId: t.feature?.milestoneId ?? null,
    });
  }
  return items;
}

/**
 * Items the agent finished and is waiting for the user to accept /
 * reject — `workflowStatus = COMPLETED`. Same shape as `fetchHalted`
 * but a different status filter and type tag.
 */
async function fetchReadyToReview(
  workspaces: Workspace[],
  userId: string,
): Promise<AttentionItem[]> {
  if (workspaces.length === 0) return [];
  const wsIds = workspaces.map((w) => w.id);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  const userFilter = {
    OR: [{ createdById: userId }, { assigneeId: userId }],
  };

  const [tasks, features] = await Promise.all([
    db.task.findMany({
      where: {
        workspaceId: { in: wsIds },
        deleted: false,
        archived: false,
        workflowStatus: { in: READY_REVIEW_STATUSES },
        status: { notIn: ["DONE", "CANCELLED"] },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        workspaceId: true,
        featureId: true,
        feature: {
          select: { initiativeId: true, milestoneId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    db.feature.findMany({
      where: {
        workspaceId: { in: wsIds },
        deleted: false,
        workflowStatus: { in: READY_REVIEW_STATUSES },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        ...userFilter,
      },
      select: {
        id: true,
        title: true,
        priority: true,
        workflowStatus: true,
        updatedAt: true,
        workspaceId: true,
        initiativeId: true,
        milestoneId: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
  ]);

  const now = Date.now();
  const taskItems: AttentionItem[] = tasks.map((t) => {
    const ws = wsById.get(t.workspaceId)!;
    return {
      id: `review:task:${t.id}`,
      type: "ready-to-review",
      title: t.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "task",
      entityId: t.id,
      link: `/w/${ws.slug}/task/${t.id}`,
      ageMs: Math.max(0, now - t.updatedAt.getTime()),
      priority: t.priority as Priority,
      workflowStatus: t.workflowStatus,
      workspaceId: t.workspaceId,
      featureId: t.featureId,
      initiativeId: t.feature?.initiativeId ?? null,
      milestoneId: t.feature?.milestoneId ?? null,
    };
  });
  const featureItems: AttentionItem[] = features.map((f) => {
    const ws = wsById.get(f.workspaceId)!;
    return {
      id: `review:feature:${f.id}`,
      type: "ready-to-review",
      title: f.title,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      entityKind: "feature",
      entityId: f.id,
      link: `/w/${ws.slug}/plan/${f.id}`,
      ageMs: Math.max(0, now - f.updatedAt.getTime()),
      priority: f.priority as Priority,
      workflowStatus: f.workflowStatus,
      workspaceId: f.workspaceId,
      initiativeId: f.initiativeId,
      milestoneId: f.milestoneId,
    };
  });

  return [...taskItems, ...featureItems];
}

const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Items older than this are dropped before sort/cap. The intro card
 * is a "what's relevant right now" surface — week-old halted runs and
 * stale FORMs add clutter and mostly indicate the user has already
 * moved on. Tunable; if it ever needs to be per-type, split into a
 * Record<AttentionItem["type"], number>.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "On canvas" = the entity projects on a sub-canvas reachable from
 * the org root. Initiatives appear on root, milestones appear on
 * initiative sub-canvases — so a feature/task with `initiativeId` or
 * `milestoneId` set lands on a canvas the user can drill into.
 * Loose features (and tasks under them) only project on the
 * workspace sub-canvas, which is one extra click away — they're
 * still reachable but feel less "in front of you."
 *
 * Used as a sort boost so attention items aligned with the visible
 * roadmap structure rank above orphans of the same type/priority.
 */
function isOnCanvas(item: AttentionItem): boolean {
  return Boolean(item.initiativeId) || Boolean(item.milestoneId);
}

/**
 * Sort: type bucket asc → on-canvas first → priority asc (CRITICAL
 * first) → oldest first within bucket. The on-canvas boost slots
 * between type and priority because "this is on the canvas you're
 * staring at" is a stronger relevance signal than priority for the
 * intro-card surface — a CRITICAL loose feature still loses to a
 * HIGH feature in an initiative the user is actively tracking.
 */
function compareItems(a: AttentionItem, b: AttentionItem): number {
  const t = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  if (t !== 0) return t;
  const oa = isOnCanvas(a) ? 0 : 1;
  const ob = isOnCanvas(b) ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const pa = a.priority ? PRIORITY_RANK[a.priority] : PRIORITY_RANK.MEDIUM;
  const pb = b.priority ? PRIORITY_RANK[b.priority] : PRIORITY_RANK.MEDIUM;
  if (pa !== pb) return pa - pb;
  return b.ageMs - a.ageMs;
}

/**
 * Deduplicate by `entityKind:entityId` — a single task that appears
 * in multiple buckets (e.g. it's halted AND has a FORM in its latest
 * message) should surface once, in the highest-priority bucket.
 * Already-sorted input means we keep the first occurrence.
 */
function dedupe(sorted: AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>();
  const out: AttentionItem[] = [];
  for (const item of sorted) {
    const key = `${item.entityKind}:${item.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * The main entry point. Fans out 4 signal queries in parallel,
 * merges, dedupes, sorts, caps. Errors in any single signal don't
 * fail the whole call — we log and return what succeeded.
 */
export async function getTopAttentionItems(args: {
  githubLogin: string;
  userId: string;
  limit?: number;
  /**
   * Optional slug allow-list — when provided, attention items are
   * only collected from workspaces whose slugs appear here. The
   * canvas caller passes the visible (non-hidden) workspaces from
   * the root canvas so hidden workspaces don't leak into the intro
   * card. Pass `undefined` (or omit) to fetch across all accessible
   * workspaces.
   */
  allowedWorkspaceSlugs?: string[] | null;
}): Promise<{ items: AttentionItem[]; total: number }> {
  const { githubLogin, userId, limit = 3, allowedWorkspaceSlugs } = args;

  const workspaces = await getAccessibleWorkspaces(
    githubLogin,
    userId,
    allowedWorkspaceSlugs,
  );
  if (workspaces.length === 0) return { items: [], total: 0 };

  const results = await Promise.allSettled([
    fetchHalted(workspaces, userId),
    fetchAwaitingReply(workspaces, userId),
    fetchPlanQuestions(workspaces, userId),
    fetchReadyToReview(workspaces, userId),
  ]);

  const merged: AttentionItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      merged.push(...r.value);
    } else {
      console.error("[attention/topItems] signal query failed:", r.reason);
    }
  }

  // Drop stale items before sorting — keeps `total` honest (the
  // "+N more" hint should reflect actually-relevant items, not
  // ancient ones we'd never surface).
  const fresh = merged.filter((item) => item.ageMs <= MAX_AGE_MS);
  fresh.sort(compareItems);
  const unique = dedupe(fresh);
  return {
    items: unique.slice(0, limit),
    total: unique.length,
  };
}
