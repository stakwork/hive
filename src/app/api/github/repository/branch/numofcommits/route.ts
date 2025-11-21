import { auth } from "@/lib/auth/auth";
import axios from "axios";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get("repoUrl");

  if (!repoUrl) {
    return NextResponse.json({ error: "Repo URL is required" }, { status: 400 });
  }

  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use user's OAuth token for branch operations (no workspace required)
    const githubProfile = await getGithubUsernameAndPAT(userId);
    if (!githubProfile?.token) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }
    const pat = githubProfile.token;

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

    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const repoData = res.data;
    const default_branch = repoData.default_branch;

    const commitNumberRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        sha: default_branch,
        per_page: 1,
      },
    });

    const linkHeader = commitNumberRes.headers.link;
    let totalCommits = 0;
    if (linkHeader) {
      const lastPageMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
      if (lastPageMatch) {
        totalCommits = parseInt(lastPageMatch[1], 10);
      }
    } else {
      totalCommits = commitNumberRes.data.length;
    }

    // Calculate date for one week ago
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const sinceDate = oneWeekAgo.toISOString();

    // Fetch commits from the last week
    const lastWeekCommitsRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        sha: default_branch,
        since: sinceDate,
        per_page: 100, // Adjust per_page as needed (GitHub API max is 100)
      },
    });

    // Count commits from last week
    let commitsFromLastWeek = lastWeekCommitsRes.data.length;
    // Handle pagination if more than 100 commits in the last week
    const lastWeekLinkHeader = lastWeekCommitsRes.headers.link;
    if (lastWeekLinkHeader) {
      const lastPageMatch = lastWeekLinkHeader.match(/page=(\d+)>; rel="last"/);
      if (lastPageMatch) {
        commitsFromLastWeek = parseInt(lastPageMatch[1], 10) * 100;
      }
    }

    const data = {
      numberOfCommits: totalCommits,
      commitsFromLastWeek: commitsFromLastWeek,
    };

    return NextResponse.json({
      message: "Number of commits",
      data,
    });
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
