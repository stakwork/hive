import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import {
  addWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/services/workspace";
import { createAndSendNotification } from "@/services/notifications";
import { getPersonalOAuthToken } from "@/lib/githubApp";
import { WorkspaceRole } from "@prisma/client";
import { WorkspaceAccessRequestStatus, NotificationTriggerType } from "@prisma/client";
import { hasRoleLevel } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * POST /api/workspaces/[slug]/access-request
 * Authenticated users request developer access to a workspace.
 * Auto-approves if the requester has a merged PR in the linked repo.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { slug } = await params;

  // 1. Load workspace
  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false },
    include: {
      repositories: { select: { repositoryUrl: true } },
    },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // 2. Check if requester already has DEVELOPER+ role
  const isOwner = workspace.ownerId === userId;
  const membership = isOwner
    ? null
    : await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId, leftAt: null },
        select: { role: true },
      });

  if (isOwner || (membership && hasRoleLevel(membership.role as WorkspaceRole, WorkspaceRole.DEVELOPER))) {
    return NextResponse.json({ status: "already_developer" });
  }

  // 3. Idempotency — check for existing PENDING or APPROVED request
  const existing = await db.workspaceAccessRequest.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
  });
  if (existing) {
    if (existing.status === WorkspaceAccessRequestStatus.APPROVED) {
      return NextResponse.json({ status: "already_developer" });
    }
    if (existing.status === WorkspaceAccessRequestStatus.PENDING) {
      return NextResponse.json({ status: "pending" });
    }
    // REJECTED — allow re-request: delete old record and proceed
    await db.workspaceAccessRequest.delete({ where: { id: existing.id } });
  }

  // 4. Load requester's GitHub username
  const githubAuth = await db.gitHubAuth.findFirst({
    where: { userId },
    select: { githubUsername: true },
  });

  // 5. Extract owner/repo from workspace repositories
  const repositoryUrl = workspace.repositories[0]?.repositoryUrl;
  const repoMatch = repositoryUrl?.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  const repoOwner = repoMatch?.[1];
  const repoName = repoMatch?.[2];

  // 6. Check GitHub merged PRs if we have the data
  if (githubAuth?.githubUsername && repoOwner && repoName) {
    try {
      const { Octokit } = await import("@octokit/rest");
      const token = await getPersonalOAuthToken(userId);
      const authToken = token ?? process.env.GITHUB_TOKEN;
      const octokit = new Octokit({ auth: authToken ?? undefined });

      const query = `repo:${repoOwner}/${repoName} is:pr is:merged author:${githubAuth.githubUsername}`;
      const searchResult = await octokit.search.issuesAndPullRequests({
        q: query,
        per_page: 1,
      });

      if (searchResult.data.total_count > 0) {
        // 7a. Auto-approve — add or update member role to DEVELOPER
        if (membership) {
          await updateWorkspaceMemberRole(workspace.id, userId, WorkspaceRole.DEVELOPER);
        } else {
          await addWorkspaceMember(workspace.id, githubAuth.githubUsername, WorkspaceRole.DEVELOPER);
        }

        // Record the approval
        await db.workspaceAccessRequest.create({
          data: {
            workspaceId: workspace.id,
            userId,
            status: WorkspaceAccessRequestStatus.APPROVED,
            resolvedAt: new Date(),
            resolvedByUserId: workspace.ownerId,
          },
        });

        return NextResponse.json({ status: "auto_approved" });
      }
    } catch (err) {
      // GitHub check failed — fall through to pending path
      console.error("[access-request] GitHub PR check failed:", err);
    }
  }

  // 8. Create PENDING access request and notify the workspace owner
  const accessRequest = await db.workspaceAccessRequest.create({
    data: {
      workspaceId: workspace.id,
      userId,
      status: WorkspaceAccessRequestStatus.PENDING,
    },
  });

  // Fire notification to workspace owner (best-effort; don't fail the request on error)
  try {
    await createAndSendNotification({
      targetUserId: workspace.ownerId,
      originatingUserId: userId,
      workspaceId: workspace.id,
      notificationType: NotificationTriggerType.WORKSPACE_ACCESS_REQUEST,
      message: `A user has requested developer access to your workspace.`,
    });
  } catch (err) {
    console.error("[access-request] Notification failed:", err);
  }

  return NextResponse.json({ status: "pending", requestId: accessRequest.id });
}

/**
 * GET /api/workspaces/[slug]/access-request
 * Returns PENDING access requests for a workspace. Admin+ only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const access = await resolveWorkspaceAccess(request, { slug });
  const ok = requireMemberAccess(access);
  if (ok instanceof NextResponse) return ok;

  // Only admins/owners can view pending requests
  if (!hasRoleLevel(ok.role as WorkspaceRole, WorkspaceRole.ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requests = await db.workspaceAccessRequest.findMany({
    where: {
      workspaceId: ok.workspaceId,
      status: WorkspaceAccessRequestStatus.PENDING,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          githubAuth: {
            select: { githubUsername: true },
          },
        },
      },
    },
    orderBy: { requestedAt: "asc" },
  });

  return NextResponse.json({ requests });
}
