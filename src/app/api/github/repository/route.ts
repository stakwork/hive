import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";
import axios from "axios";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get("repoUrl");

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
      const ssh = u.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (ssh) return { owner: ssh[1], repo: ssh[2] };
      // HTTPS form
      const https = u.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/?$/i);
      if (https) return { owner: https[1], repo: https[2] };
      throw new Error(`Cannot parse owner/repo from: ${url}`);
    }

    const { owner, repo } = parseOwnerRepo(repoUrl);

    // Use GitHub App token only (no OAuth fallback)
    const tokens = await getUserAppTokens(userId, owner);

    if (!tokens?.accessToken) {
      return NextResponse.json({
        error: "No GitHub App tokens found for this repository owner. Please ensure the GitHub App is installed for this organization/user."
      }, { status: 403 });
    }

    console.log("Using GitHub App installation token");

    // GitHub App tokens always use Bearer format
    const authHeader = `Bearer ${tokens.accessToken}`;

    console.log("Making GitHub API request with GitHub App token");

    // Make direct repository API call (same as original purpose)
    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const repoData = res.data;

    // Check push permissions and return repository data
    if (repoData.permissions?.push) {
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
        message: "Repository data retrieved successfully",
        data,
      });
    } else {
      return NextResponse.json({
        error: "You do not have push access to this repository"
      }, { status: 403 });
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