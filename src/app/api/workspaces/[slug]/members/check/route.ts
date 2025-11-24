import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import {
  findUserByGitHubUsername,
  findActiveMember,
  isWorkspaceOwner,
} from "@/lib/helpers/workspace-member-queries";

/**
 * GET /api/workspaces/[slug]/members/check
 * 
 * Checks if a GitHub user is a member of the workspace.
 * Returns isMember=true if:
 * 1. User not found in system (can be invited)
 * 2. User is already an active member
 * 3. User is the workspace owner
 * 
 * Query params:
 * - githubUsername: GitHub username to check
 * 
 * Requires:
 * - Authenticated session
 * - Workspace member access (any role)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // 1. AUTHENTICATION
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    const userId = (session.user as { id: string }).id;

    // 2. EXTRACT QUERY PARAMETER
    const { searchParams } = new URL(request.url);
    const githubUsername = searchParams.get("githubUsername");
    
    if (!githubUsername) {
      return NextResponse.json(
        { error: "Missing required parameter: githubUsername" },
        { status: 400 }
      );
    }

    // 3. VALIDATE WORKSPACE ACCESS
    const { slug } = await params;
    const workspaceAccess = await validateWorkspaceAccess(slug, userId);
    
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    if (!workspaceAccess.workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const workspaceId = workspaceAccess.workspace.id;

    // 4. CHECK MEMBERSHIP STATUS
    
    // Find user by GitHub username
    const githubUser = await findUserByGitHubUsername(githubUsername);
    
    // If user not found in system, they can be invited
    if (!githubUser) {
      return NextResponse.json(
        {
          isMember: true,
          reason: "User not found in system",
        },
        { status: 200 }
      );
    }

    const targetUserId = githubUser.userId;

    // Check if already active member
    const activeMember = await findActiveMember(workspaceId, targetUserId);
    if (activeMember) {
      return NextResponse.json(
        {
          isMember: true,
          userId: targetUserId,
          reason: "Already active member",
        },
        { status: 200 }
      );
    }

    // Check if workspace owner
    const isOwner = await isWorkspaceOwner(workspaceId, targetUserId);
    if (isOwner) {
      return NextResponse.json(
        {
          isMember: true,
          userId: targetUserId,
          reason: "Is workspace owner",
        },
        { status: 200 }
      );
    }

    // User exists but is not a member
    return NextResponse.json(
      {
        isMember: false,
        userId: targetUserId,
        reason: "Not a member",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error checking workspace membership:", error);
    return NextResponse.json(
      { error: "Failed to check membership status" },
      { status: 500 }
    );
  }
}