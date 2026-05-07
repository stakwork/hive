/**
 * Shared loader for org canvas live-node detail.
 *
 * Two consumers:
 *   1. `GET /api/orgs/[githubLogin]/canvas/node/[liveId]` — the right
 *      panel's Details tab calls this when the user clicks a projected
 *      live node on the canvas.
 *   2. The canvas-chat agent's `read_initiative` / `read_milestone`
 *      tools (`src/lib/ai/initiativeTools.ts`) — so the agent can
 *      pull full descriptions for live nodes it sees through
 *      `read_canvas` (which only returns the projector's render-time
 *      shape: name + footer counts, NOT description).
 *
 * Both paths need exactly the same org-ownership guard: live ids
 * travel through `?canvas=` URLs, Pusher payloads, and now agent
 * conversations, so an authenticated user could otherwise pull any
 * org's data by guessing a cuid. Centralizing the lookup means there's
 * one place to evolve the response shape and one place to enforce the
 * cross-org check.
 */
import { db } from "@/lib/db";

export interface NodeDetail {
  kind: string;
  id: string;
  name: string;
  description: string | null;
  /** Optional kind-specific extras the panel can render. */
  extras?: Record<string, unknown>;
}

/**
 * Resolve a `<kind>:<id>` live-node reference into its detail row,
 * scoped to `orgId`. Returns `null` for "not found" AND for "found in
 * a different org" — the caller should treat both as 404 to avoid
 * leaking existence across org boundaries. Unknown kinds also return
 * `null` so callers don't have to enumerate them.
 */
export async function loadNodeDetail(
  kind: string,
  id: string,
  orgId: string,
): Promise<NodeDetail | null> {
  switch (kind) {
    case "ws": {
      const ws = await db.workspace.findFirst({
        where: { id, sourceControlOrgId: orgId, deleted: false },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          _count: { select: { repositories: true, members: true } },
        },
      });
      if (!ws) return null;
      return {
        kind: "workspace",
        id: ws.id,
        name: ws.name,
        description: ws.description,
        extras: {
          slug: ws.slug,
          repoCount: ws._count.repositories,
          memberCount: ws._count.members,
        },
      };
    }
    case "repo": {
      const repo = await db.repository.findFirst({
        where: { id, workspace: { sourceControlOrgId: orgId, deleted: false } },
        select: {
          id: true,
          name: true,
          repositoryUrl: true,
          branch: true,
          status: true,
          workspace: { select: { slug: true } },
        },
      });
      if (!repo) return null;
      return {
        kind: "repository",
        id: repo.id,
        name: repo.name,
        // Repository has no `description` column; surface URL/branch
        // as the body line instead so the panel has something to show.
        description: null,
        extras: {
          repositoryUrl: repo.repositoryUrl,
          branch: repo.branch,
          status: repo.status,
          workspaceSlug: repo.workspace.slug,
        },
      };
    }
    case "initiative": {
      const init = await db.initiative.findFirst({
        where: { id, orgId },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          startDate: true,
          targetDate: true,
          completedAt: true,
          assignee: { select: { id: true, name: true, image: true } },
          _count: { select: { milestones: true } },
        },
      });
      if (!init) return null;
      return {
        kind: "initiative",
        id: init.id,
        name: init.name,
        description: init.description,
        extras: {
          status: init.status,
          startDate: init.startDate,
          targetDate: init.targetDate,
          completedAt: init.completedAt,
          assignee: init.assignee,
          milestoneCount: init._count.milestones,
        },
      };
    }
    case "milestone": {
      const ms = await db.milestone.findFirst({
        where: { id, initiative: { orgId } },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          dueDate: true,
          completedAt: true,
          sequence: true,
          assignee: { select: { id: true, name: true, image: true } },
          initiative: { select: { id: true, name: true } },
          _count: { select: { features: true } },
        },
      });
      if (!ms) return null;
      return {
        kind: "milestone",
        id: ms.id,
        name: ms.name,
        description: ms.description,
        extras: {
          status: ms.status,
          dueDate: ms.dueDate,
          completedAt: ms.completedAt,
          sequence: ms.sequence,
          assignee: ms.assignee,
          initiative: ms.initiative,
          featureCount: ms._count.features,
        },
      };
    }
    case "feature": {
      const feat = await db.feature.findFirst({
        where: {
          id,
          deleted: false,
          workspace: { sourceControlOrgId: orgId, deleted: false },
        },
        select: {
          id: true,
          title: true,
          brief: true,
          status: true,
          priority: true,
          // Surface the live workflow status so the canvas-sidebar
          // chat can hydrate its `inputDisabled` gate without a
          // second per-node fetch to `/api/features/[id]`.
          workflowStatus: true,
          assignee: { select: { id: true, name: true, image: true } },
          workspace: { select: { slug: true } },
          _count: {
            select: { tasks: { where: { deleted: false, archived: false } } },
          },
        },
      });
      if (!feat) return null;
      return {
        kind: "feature",
        id: feat.id,
        name: feat.title,
        // Feature uses `brief` not `description`. Surface it as the
        // body so the side panel can render Markdown the same way it
        // does for other kinds.
        description: feat.brief,
        extras: {
          status: feat.status,
          priority: feat.priority,
          workflowStatus: feat.workflowStatus,
          assignee: feat.assignee,
          workspaceSlug: feat.workspace.slug,
          taskCount: feat._count.tasks,
        },
      };
    }
    case "research": {
      // Research rows belong to the org directly (no workspace
      // intermediary), and an optional `initiativeId` scopes them to
      // a sub-canvas. The on-canvas card label (`topic`) and the
      // viewer-header `title` are intentionally separate — see
      // `Research` in schema.prisma for the rationale. We surface
      // both plus `summary` and the markdown `content` so the right
      // panel can render the full doc without a second fetch.
      const research = await db.research.findFirst({
        where: { id, orgId },
        select: {
          id: true,
          slug: true,
          topic: true,
          title: true,
          summary: true,
          content: true,
          initiativeId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!research) return null;
      return {
        kind: "research",
        id: research.id,
        // The viewer header reads `title` (polished); fall back to
        // `topic` if for some reason title is empty.
        name: research.title || research.topic,
        // We reuse the standard `description` field for the markdown
        // body so the viewer can use the same ReactMarkdown render
        // pipeline as note/decision authored bodies. `content` is
        // null while the agent is still researching — the viewer
        // shows a pending spinner in that case.
        description: research.content,
        extras: {
          slug: research.slug,
          topic: research.topic,
          summary: research.summary,
          // Status mirrors what the projector stamps on the canvas
          // node: ready when content has landed, researching while
          // it's still null. The viewer reads this to switch between
          // markdown render and pending spinner.
          status: research.content !== null ? "ready" : "researching",
          initiativeId: research.initiativeId,
          createdAt: research.createdAt,
          updatedAt: research.updatedAt,
        },
      };
    }
    case "task": {
      const task = await db.task.findFirst({
        where: {
          id,
          deleted: false,
          workspace: { sourceControlOrgId: orgId, deleted: false },
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
          assignee: { select: { id: true, name: true, image: true } },
          workspace: { select: { slug: true } },
          feature: { select: { id: true, title: true } },
        },
      });
      if (!task) return null;
      return {
        kind: "task",
        id: task.id,
        name: task.title,
        description: task.description,
        extras: {
          status: task.status,
          priority: task.priority,
          workflowStatus: task.workflowStatus,
          assignee: task.assignee,
          workspaceSlug: task.workspace.slug,
          feature: task.feature,
        },
      };
    }
    default:
      return null;
  }
}
