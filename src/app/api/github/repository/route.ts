import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import axios from "axios";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get("repoUrl");
  const workspaceSlug = searchParams.get("workspaceSlug");

  if (!repoUrl) {
    return NextResponse.json({ error: "Repo URL is required" }, { status: 400 });
  }

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id: string }).id;

    function parseOwnerRepo(url: string): { owner: string; repo: string } {
      const u = url.replace(/\.git$/i, "");
      // SSH form
      const ssh = u.match(/^git@[^:]+:([^/]+)\/([^/]+)$/);
      if (ssh) return { owner: ssh[1], repo: ssh[2] };
      // HTTPS form
      const https = u.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/i);
      if (https) return { owner: https[1], repo: https[2] };
      throw new Error(`Cannot parse owner/repo from: ${url}`);
    }

    const { owner, repo } = parseOwnerRepo(repoUrl);

    // Try to use GitHub App installation token first, fall back to OAuth token
    let accessToken;

    // First try GitHub App installation token if we have a workspace
    if (workspaceSlug) {
      try {
        const workspace = await db.workspace.findUnique({
          where: { slug: workspaceSlug },
          include: { sourceControlOrg: true }
        });

        if (workspace?.sourceControlOrg?.githubLogin) {
          const appTokens = await getUserAppTokens(userId, workspace.sourceControlOrg.githubLogin);
          if (appTokens?.accessToken) {
            accessToken = appTokens.accessToken;
            console.log("Using GitHub App installation token");
          }
        }
      } catch (error) {
        console.warn("Could not get GitHub App token, falling back to OAuth token:", error);
      }
    }

    // Fall back to OAuth token if GitHub App token not available
    if (!accessToken) {
      const githubProfile = await getGithubUsernameAndPAT(userId);
      if (!githubProfile?.token) {
        return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
      }
      accessToken = githubProfile.token;
      console.log("Using OAuth token");
    }

    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const repoData = res.data;

    if (repoData.permissions.push) {
      const data = {
        id: repoData.id,
        name: repoData.name,
        full_name: repoData.full_name,
        description: repoData.description,
        private: repoData.private,
        fork: repoData.fork,
        stargazers_count: repoData.stargazers_count,
        watchers_count: repoData.watchers_count,
        default_branch: repoData.default_branch,
        updated_at: repoData.updated_at,
        html_url: repoData.html_url,
        clone_url: repoData.clone_url,
        size: repoData.size,
        open_issues_count: repoData.open_issues_count,
        topics: repoData.topics || [],
      };

      return NextResponse.json({
        message: "Repo is pushable",
        data,
      });
    } else {
      return NextResponse.json({ error: "You do not have push access to this repository" }, { status: 403 });
    }
  } catch (error: unknown) {
    console.error("Error fetching repositories:", error);

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      error.response.status === 401
    ) {
      return NextResponse.json({ error: "GitHub token expired or invalid" }, { status: 401 });
    }

    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
  }
}
