import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Check that the GitHub App token can actually fetch data from a specific repository
 * This validates both authentication and repository access permissions
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({
        canFetchData: false,
        error: "Unauthorized"
      }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");
    const repositoryUrl = searchParams.get("repositoryUrl");

    if (!workspaceSlug) {
      return NextResponse.json({
        canFetchData: false,
        error: "Missing required parameter: workspaceSlug"
      }, { status: 400 });
    }

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({
        canFetchData: false,
        error: "Workspace not found or access denied"
      }, { status: 403 });
    }

    // Get workspace and its swarm to extract repository URL
    const { db } = await import("@/lib/db");
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({
        canFetchData: false,
        error: "Workspace not found"
      }, { status: 404 });
    }

    // Use repositoryUrl parameter first, fall back to workspace swarm repository URL
    const repoUrl = repositoryUrl || workspace.swarm?.repositoryUrl;
    if (!repoUrl) {
      return NextResponse.json({
        canFetchData: false,
        error: "No repository URL provided in parameter or workspace configuration"
      }, { status: 400 });
    }

    console.log("[REPO CHECK] Starting repository data fetch check:", {
      userId: session.user.id,
      workspaceSlug,
      repositoryUrl: repoUrl,
      source: repositoryUrl ? "parameter" : "workspace.swarm",
    });

    // Extract owner and repo name from repository URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      console.error("[REPO CHECK] Invalid GitHub repository URL:", repoUrl);
      return NextResponse.json({
        canFetchData: false,
        error: "Invalid GitHub repository URL"
      }, { status: 400 });
    }

    const [, owner, repo] = githubMatch;
    console.log("[REPO CHECK] Parsed repository:", { owner, repo });

    // Get access token for the specific GitHub owner
    const tokens = await getUserAppTokens(session.user.id, owner);
    if (!tokens?.accessToken) {
      console.error("[REPO CHECK] No access token available for user:", session.user.id, "and owner:", owner);
      return NextResponse.json({
        canFetchData: false,
        error: "No GitHub App tokens found for this repository owner"
      }, { status: 200 });
    }

    console.log("[REPO CHECK] Successfully retrieved access token");

    // Test actual repository data access by fetching repository info
    const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    console.log("[REPO CHECK] Testing repository access with:", repoInfoUrl);

    const response = await fetch(repoInfoUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    console.log("[REPO CHECK] GitHub API response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[REPO CHECK] Failed to fetch repository data:", response.status, response.statusText);
      console.error("[REPO CHECK] Error response body:", errorText);

      let errorMessage = "Failed to fetch repository data";
      if (response.status === 404) {
        errorMessage = "Repository not found or no access";
      } else if (response.status === 403) {
        errorMessage = "Access forbidden - insufficient permissions";
      } else if (response.status === 401) {
        errorMessage = "Authentication failed - invalid token";
      }

      return NextResponse.json({
        canFetchData: false,
        error: errorMessage,
        httpStatus: response.status
      }, { status: 200 });
    }

    const repoData = await response.json();
    console.log("[REPO CHECK] Successfully fetched repository data:", {
      name: repoData.name,
      full_name: repoData.full_name,
      private: repoData.private,
      permissions: repoData.permissions,
    });

    // Check push permissions
    const hasPushAccess = !!(
      repoData.permissions?.push ||
      repoData.permissions?.admin ||
      repoData.permissions?.maintain
    );
    console.log("[REPO CHECK] Push access analysis:", {
      push: repoData.permissions?.push,
      admin: repoData.permissions?.admin,
      maintain: repoData.permissions?.maintain,
      hasPushAccess,
    });

    // Test fetching commits to ensure we can read repository content
    const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits`;
    console.log("[REPO CHECK] Testing commits access with:", commitsUrl);

    const commitsResponse = await fetch(`${commitsUrl}?per_page=1`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    console.log("[REPO CHECK] Commits API response status:", commitsResponse.status);

    let canReadCommits = false;
    if (commitsResponse.ok) {
      const commitsData = await commitsResponse.json();
      canReadCommits = Array.isArray(commitsData) && commitsData.length >= 0;
      console.log("[REPO CHECK] Successfully fetched commits data, count:", commitsData.length);
    } else {
      console.error("[REPO CHECK] Failed to fetch commits:", commitsResponse.status, commitsResponse.statusText);
    }

    console.log("[REPO CHECK] Final result: Repository data can be fetched successfully");

    return NextResponse.json({
      canFetchData: true,
      hasPushAccess,
      repositoryInfo: {
        name: repoData.name,
        full_name: repoData.full_name,
        private: repoData.private,
        default_branch: repoData.default_branch,
        permissions: repoData.permissions,
      },
      canReadCommits,
      message: "GitHub App can successfully fetch repository data"
    }, { status: 200 });

  } catch (error) {
    console.error("[REPO CHECK] Error during repository data fetch check:", error);
    return NextResponse.json({
      canFetchData: false,
      error: "Internal server error during repository check"
    }, { status: 500 });
  }
}