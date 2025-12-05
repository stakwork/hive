import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { serviceConfigs } from "@/config/services";
import axios from "axios";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id: string }).id;

    // Use user's OAuth token for repository listing (no workspace required)
    const githubProfile = await getGithubUsernameAndPAT(userId);
    if (!githubProfile?.token) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }
    const pat = githubProfile.token;

    // Fetch repositories from GitHub API
    const response = await axios.get(`${serviceConfigs.github.baseURL}/user/repos`, {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        sort: "updated",
        per_page: 100, // Get up to 100 repositories
        type: "all", // Include both owned and contributed repos
      },
    });

    const repositories = response.data.map((repo: Record<string, unknown>) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      fork: repo.fork,
      stargazers_count: repo.stargazers_count,
      watchers_count: repo.watchers_count,
      language: repo.language,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      size: repo.size,
      open_issues_count: repo.open_issues_count,
      topics: repo.topics || [],
    }));

    return NextResponse.json({
      repositories,
      total_count: repositories.length,
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
