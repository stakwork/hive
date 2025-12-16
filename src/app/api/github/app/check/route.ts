import { serviceConfigs } from "@/config/services";
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
    const repoUrl = searchParams.get("repositoryUrl");

    if (!repoUrl) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Missing required parameter: repositoryUrl"
      }, { status: 400 });
    }



    // Extract owner and repo name from repository URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return NextResponse.json({
        hasPushAccess: false,
        error: "Invalid GitHub repository URL"
      }, { status: 400 });
    }

    const [, owner, repo] = githubMatch;

    console.log('owner', owner)
    console.log('repo', repo)

    // Get access token for the specific GitHub owner
    const tokens = await getUserAppTokens(session.user.id, owner);

    console.log('tokens', tokens)
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
    const installationReposUrl = `${serviceConfigs.github.baseURL}/user/installations/${installationId}/repositories?per_page=100`;


    console.log('installationReposUrl', installationReposUrl)
    console.log(tokens.accessToken, installationId)
    console.log('installationReposUrl')

    const token = tokens.accessToken;

    const response = await fetch(installationReposUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      console.error(`[REPO CHECK] GitHub API error: ${response.status} ${response.statusText}`);

      let errorMessage = "Failed to access installation repositories";
      let requiresReauth = false;

      if (response.status === 401) {
        errorMessage = "GitHub App token is invalid or expired";
        requiresReauth = true;
      } else if (response.status === 403) {
        errorMessage = "No permission to access installation repositories";
        requiresReauth = true;
      } else if (response.status === 404) {
        errorMessage = "Installation not found or no access to this installation";
      } else if (response.status >= 500) {
        errorMessage = "GitHub API is temporarily unavailable";
      }

      return NextResponse.json({
        hasPushAccess: false,
        error: errorMessage,
        requiresReauth,
        installationId: sourceControlOrg?.githubInstallationId
      }, { status: 200 });
    }

    const installationData = await response.json();
    const targetRepoFullName = `${owner}/${repo}`.toLowerCase();

    // Check if the target repository is accessible through this installation
    const repositoryAccess = installationData.repositories?.find(
      (repository: { full_name: string; permissions?: { push?: boolean; admin?: boolean; maintain?: boolean } }) =>
        repository.full_name.toLowerCase() === targetRepoFullName
    );


    if (!repositoryAccess) {
      console.warn(`[REPO CHECK] Repository '${targetRepoFullName}' not found in installation ${installationId}`);
      console.warn(`[REPO CHECK] Available repositories:`, installationData.repositories?.map((r: { full_name: string }) => r.full_name) || []);

      return NextResponse.json({
        hasPushAccess: false,
        error: `Repository '${owner}/${repo}' is not accessible through the GitHub App installation. Please ensure the repository is included in the app's permissions or reinstall the app with access to this repository.`,
        requiresInstallationUpdate: true,
        installationId: sourceControlOrg?.githubInstallationId
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