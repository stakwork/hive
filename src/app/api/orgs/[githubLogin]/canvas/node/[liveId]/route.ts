import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

/**
 * Detail endpoint for a single live canvas node.
 *
 * The org canvas projects DB entities onto nodes whose ids carry a
 * prefix indicating their kind: `ws:<id>`, `repo:<id>`, `initiative:<id>`,
 * `milestone:<id>`, `feature:<id>`, `task:<id>`. The projector itself
 * only emits the bare minimum needed for rendering (name + a few
 * footer counts); the side panel needs more — at minimum, the entity's
 * `description`. This endpoint resolves the prefix, looks up the
 * entity, and verifies it actually belongs to the org in the URL.
 *
 * The cross-org guard is the load-bearing security check here: live
 * ids travel through `?canvas=` URLs and Pusher payloads and aren't
 * scoped to the viewer's org otherwise. Without this check, an
 * authenticated user could read any initiative's description by
 * guessing a cuid.
 *
 * 404 covers both "entity doesn't exist" and "entity exists in a
 * different org" — never leak existence across org boundaries.
 */

const PREFIX_RE = /^([a-z]+):(.+)$/;

interface NodeDetailResponse {
  kind: string;
  id: string;
  name: string;
  description: string | null;
  /** Optional kind-specific extras the panel can render. */
  extras?: Record<string, unknown>;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; liveId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, liveId: rawLiveId } = await params;
  // Next.js URL-decodes path segments, but defensively decode again
  // so a double-encoded id doesn't slip through as `ws%3Aabc`.
  const liveId = decodeURIComponent(rawLiveId);

  const match = PREFIX_RE.exec(liveId);
  if (!match) {
    return NextResponse.json({ error: "Invalid live id" }, { status: 400 });
  }
  const [, kind, id] = match;

  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const detail = await loadDetail(kind, id, org.id);
    if (!detail) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[GET /api/orgs/.../canvas/node/[liveId]] Error:", error);
    return NextResponse.json({ error: "Failed to load node" }, { status: 500 });
  }
}

async function loadDetail(
  kind: string,
  id: string,
  orgId: string,
): Promise<NodeDetailResponse | null> {
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
      // Repos belong to a workspace; verify that workspace belongs to
      // the org. Single query via the relation predicate.
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
          _count: { select: { tasks: { where: { deleted: false, archived: false } } } },
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
