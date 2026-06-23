/**
 * `checkPgAccess` — real membership enforcement for `pg:` URNs.
 *
 * Replaces the always-`true` stub with per-type rules:
 *
 *   Org-scoped:        initiative, milestone, research
 *     → verify ctx.orgId matches the SourceControlOrg for the URN's {org}
 *
 *   Workspace-scoped:  feature, task, repository, workflowtask, chatmessage, deployment
 *     → verify ctx.workspaceId matches the entity's workspaceId
 *       (or ctx.userId is a WorkspaceMember of that workspace as fallback)
 *
 *   Unknown type:      return false
 */

import { db } from "@/lib/db";
import { parseUrn } from "./parse";

export interface PgAccessContext {
  userId: string | null;
  orgId?: string;
  workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Org-scoped entities
// ---------------------------------------------------------------------------

const ORG_SCOPED_TYPES = new Set(["initiative", "milestone", "research"]);

async function checkOrgScoped(
  org: string,
  ctx: PgAccessContext
): Promise<boolean> {
  if (!ctx.orgId) return false;
  const row = await db.sourceControlOrg.findUnique({
    where: { githubLogin: org },
    select: { id: true },
  });
  return row?.id === ctx.orgId;
}

// ---------------------------------------------------------------------------
// Workspace-scoped entities
// ---------------------------------------------------------------------------

const WORKSPACE_SCOPED_TYPES = new Set([
  "feature",
  "task",
  "repository",
  "workflowtask",
  "chatmessage",
  "deployment",
]);

// Map from URN type → Prisma model accessor and workspace FK field
const WORKSPACE_FK_MAP: Record<
  string,
  { model: string; field: string }
> = {
  feature:      { model: "feature",     field: "workspaceId" },
  task:         { model: "task",        field: "workspaceId" },
  repository:   { model: "repository",  field: "workspaceId" },
  workflowtask: { model: "workflowTask", field: "taskId" }, // workflowTask → look up via task
  chatmessage:  { model: "chatMessage", field: "taskId" },  // no direct workspaceId — covered below
  deployment:   { model: "deployment",  field: "taskId" },  // no direct workspaceId — covered below
};

async function resolveEntityWorkspaceId(
  type: string,
  id: string
): Promise<string | null> {
  // Direct workspaceId on entity
  if (type === "feature" || type === "task" || type === "repository") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (db as any)[WORKSPACE_FK_MAP[type].model];
    const row = await model?.findFirst({
      where: { id },
      select: { workspaceId: true },
    });
    return row?.workspaceId ?? null;
  }

  // WorkflowTask → no workspaceId; resolve through Task
  if (type === "workflowtask") {
    const wt = await db.workflowTask.findFirst({
      where: { id },
      select: { taskId: true },
    });
    if (!wt) return null;
    const task = await db.task.findFirst({
      where: { id: wt.taskId },
      select: { workspaceId: true },
    });
    return task?.workspaceId ?? null;
  }

  // ChatMessage → resolve through task or feature
  if (type === "chatmessage") {
    const msg = await db.chatMessage.findFirst({
      where: { id },
      select: { taskId: true, featureId: true },
    });
    if (!msg) return null;
    if (msg.taskId) {
      const task = await db.task.findFirst({
        where: { id: msg.taskId },
        select: { workspaceId: true },
      });
      return task?.workspaceId ?? null;
    }
    if (msg.featureId) {
      const feature = await db.feature.findFirst({
        where: { id: msg.featureId },
        select: { workspaceId: true },
      });
      return feature?.workspaceId ?? null;
    }
    return null;
  }

  // Deployment → resolve through task
  if (type === "deployment") {
    const dep = await db.deployment.findFirst({
      where: { id },
      select: { taskId: true },
    });
    if (!dep) return null;
    const task = await db.task.findFirst({
      where: { id: dep.taskId },
      select: { workspaceId: true },
    });
    return task?.workspaceId ?? null;
  }

  return null;
}

async function checkWorkspaceScoped(
  type: string,
  id: string,
  ctx: PgAccessContext
): Promise<boolean> {
  const entityWorkspaceId = await resolveEntityWorkspaceId(type, id);
  if (!entityWorkspaceId) return false;

  // Direct workspace match
  if (ctx.workspaceId && ctx.workspaceId === entityWorkspaceId) return true;

  // Fallback: userId is a member of the entity's workspace
  if (ctx.userId) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: entityWorkspaceId, userId: ctx.userId },
      select: { id: true },
    });
    return member !== null;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function checkPgAccess(
  urn: string,
  ctx: PgAccessContext
): Promise<boolean> {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "pg") return false;

  if (ORG_SCOPED_TYPES.has(parsed.type)) {
    return checkOrgScoped(parsed.org, ctx);
  }

  if (WORKSPACE_SCOPED_TYPES.has(parsed.type)) {
    return checkWorkspaceScoped(parsed.type, parsed.id, ctx);
  }

  return false;
}
