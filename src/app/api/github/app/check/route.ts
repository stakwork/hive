import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Check if the user has push permissions to a repository
 * Returns true if user has a valid token and push access, false otherwise
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Unauthorized"
      }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const repositoryUrl = searchParams.get("repositoryUrl");

    if (!repositoryUrl) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Missing required parameter: repositoryUrl"
      }, { status: 400 });
    }

    // Extract owner and repo name from repository URL
    const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Invalid GitHub repository URL"
      }, { status: 400 });
    }

    const [, owner, repo] = githubMatch;

    // Get access token for the specific GitHub owner
    const tokens = await getUserAppTokens(session.user.id, owner);
    if (!tokens?.accessToken) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "No GitHub App tokens found for this repository owner"
      }, { status: 403 });
    }

    // First, get the installation ID for this owner
    const sourceControlOrg = await db.sourceControlOrg.findUnique({
      where: { githubLogin: owner },
      select: { githubInstallationId: true }
    });

    if (!sourceControlOrg?.githubInstallationId) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "No GitHub App installation found for this repository owner"
      }, { status: 200 });
    }

    // Check installation-specific repository access
    const installationId = sourceControlOrg.githubInstallationId;
    const installationReposUrl = `https://api.github.com/user/installations/${installationId}/repositories`;

    const response = await fetch(installationReposUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      return NextResponse.json({
        hasPushAccess: false,
        error: response.status === 404 ? "Installation not found or no access" : "Failed to access installation repositories"
      }, { status: 200 });
    }

    const installationData = await response.json();
    const targetRepoFullName = `${owner}/${repo}`.toLowerCase();

    // Check if the target repository is accessible through this installation
    const repositoryAccess = installationData.repositories?.find(
      (repository: { full_name: string; permissions?: any }) =>
        repository.full_name.toLowerCase() === targetRepoFullName
    );

    if (!repositoryAccess) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Repository not accessible through GitHub App installation"
      }, { status: 200 });
    }

    // Check push permissions on the installation-accessible repository
    const hasPushAccess = !!(
      repositoryAccess.permissions?.push ||
      repositoryAccess.permissions?.admin ||
      repositoryAccess.permissions?.maintain
    );

    return NextResponse.json({
      hasPushAccess
    }, { status: 200 });

  } catch (error) {
    console.error("[REPO CHECK] Error during repository check:", error);
    return NextResponse.json({
      hasPushAccess: false,
      error: "Internal server error"
    }, { status: 500 });
  }
}