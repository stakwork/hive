import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import {
  getWorkspaceMembers,
  addWorkspaceMember,
  validateWorkspaceAccess,
  getWorkspaceBySlug,
} from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/workspaces/[slug]/members - Get all workspace members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;
    const isSuperAdmin = await checkIsSuperAdmin(userId);

    // Check workspace access
    const workspace = await getWorkspaceBySlug(slug, userId, { isSuperAdmin });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    // Check if system assignees should be included (defaults to false)
    const url = new URL(request.url);
    const includeSystemAssignees = url.searchParams.get("includeSystemAssignees") === "true";
    const sphinxLinkedOnly = url.searchParams.get("sphinxLinkedOnly") === "true";

    const result = await getWorkspaceMembers(workspace.id, includeSystemAssignees, sphinxLinkedOnly);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching workspace members:", error);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}

// POST /api/workspaces/[slug]/members - Add a member to workspace
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;
    const body = await request.json();

    const { githubUsername, role, bypassAccessWarning } = body;

    if (!githubUsername || !role) {
      return NextResponse.json(
        { error: "GitHub username and role are required" },
        { status: 400 }
      );
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check workspace access and admin permissions
    const isSuperAdmin = await checkIsSuperAdmin(userId);
    const access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Check repository access for the new user if workspace has repositories
    const repositories = await db.repository.findMany({
      where: { workspaceId: access.workspace.id },
      select: {
        id: true,
        repositoryUrl: true,
        name: true,
      },
    });

    if (repositories.length > 0 && !bypassAccessWarning) {
      const { checkRepositoryAccess } = await import("@/lib/githubApp");
      
      // Find the user first to get their userId
      const githubAuth = await db.gitHubAuth.findFirst({
        where: { githubUsername: githubUsername },
        select: { userId: true },
      });

      if (!githubAuth) {
        return NextResponse.json(
          { error: "User not found. They must sign up to Hive first." },
          { status: 400 }
        );
      }

      // Check access to all workspace repositories
      const accessChecks = await Promise.all(
        repositories.map(async (repo) => {
          try {
            const accessCheck = await checkRepositoryAccess(
              githubAuth.userId,
              repo.repositoryUrl
            );
            return {
              repositoryUrl: repo.repositoryUrl,
              repositoryName: repo.name,
              hasAccess: accessCheck.hasAccess,
              error: accessCheck.error,
            };
          } catch (error) {
            console.error(`Error checking access to ${repo.repositoryUrl}:`, error);
            return {
              repositoryUrl: repo.repositoryUrl,
              repositoryName: repo.name,
              hasAccess: false,
              error: "Failed to check access",
            };
          }
        })
      );

      const inaccessibleRepos = accessChecks.filter((check) => !check.hasAccess);

      if (inaccessibleRepos.length > 0) {
        return NextResponse.json(
          {
            error: "access_validation_failed",
            message: `User @${githubUsername} does not have access to ${inaccessibleRepos.length} repository/repositories in this workspace`,
            inaccessibleRepositories: inaccessibleRepos,
            requiresBypass: true,
          },
          { status: 422 }
        );
      }
    }

    const member = await addWorkspaceMember(access.workspace.id, githubUsername, role);
    return NextResponse.json({ member }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error adding workspace member:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      
      if (error.message.includes("already a member") || error.message.includes("Cannot add")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}
