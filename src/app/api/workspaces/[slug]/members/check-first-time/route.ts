import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { hasInvitedUserBefore } from "@/lib/helpers/workspace-member-queries";
import { findUserByGitHubUsername } from "@/lib/helpers/workspace-member-queries";

/**
 * Check if the current user has invited a specific GitHub user before
 * Used for conditional confirmation dialog on first-time invites
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const githubUsername = searchParams.get("githubUsername");

    if (!githubUsername) {
      return NextResponse.json(
        { error: "GitHub username is required" },
        { status: 400 }
      );
    }

    const inviterId = (session.user as { id: string }).id;

    // Find the user being invited
    const githubAuth = await findUserByGitHubUsername(githubUsername);
    if (!githubAuth) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if inviter has invited this user before (across all workspaces)
    const hasInvitedBefore = await hasInvitedUserBefore(inviterId, githubAuth.userId);

    return NextResponse.json({
      isFirstTime: !hasInvitedBefore,
      githubUsername,
    });
  } catch (error: unknown) {
    console.error("Error checking first-time invite:", error);
    return NextResponse.json(
      { error: "Failed to check invite status" },
      { status: 500 }
    );
  }
}