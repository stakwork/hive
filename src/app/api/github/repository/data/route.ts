import { authOptions } from "@/lib/auth/nextauth";
import { serviceConfigs } from "@/config/services";
import { getUserAppTokens } from "@/lib/githubApp";
import { RepositoryData, GitHubContributor, GitHubIssue } from "@/types/github";
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

    // Use GitHub App token
    const tokens = await getUserAppTokens(userId, owner);

    if (!tokens?.accessToken) {
      return NextResponse.json({
        error: "No GitHub App tokens found for this repository owner. Please ensure the GitHub App is installed for this organization/user."
      }, { status: 403 });
    }

    // GitHub App tokens always use Bearer format
    const authHeader = `Bearer ${tokens.accessToken}`;
    const githubApi = axios.create({
      baseURL: serviceConfigs.github.baseURL,
      headers: {
        Authorization: authHeader,
        Accept: "application/vnd.github.v3+json",
      },
    });

    // Fetch repository basic data
    const repoResponse = await githubApi.get(`/repos/${owner}/${repo}`);
    const repoData = repoResponse.data;

    // Fetch contributors (limit to top 30)
    const contributorsResponse = await githubApi.get(`/repos/${owner}/${repo}/contributors?per_page=30`);
    const contributors: GitHubContributor[] = contributorsResponse.data.map((contributor: any) => ({
      login: contributor.login,
      id: contributor.id,
      avatar_url: contributor.avatar_url,
      html_url: contributor.html_url,
      contributions: contributor.contributions,
    }));

    // Fetch recent issues (limit to 20 most recent)
    const issuesResponse = await githubApi.get(`/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=20`);
    const recent_issues: GitHubIssue[] = issuesResponse.data.map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url,
      user: {
        login: issue.user.login,
        avatar_url: issue.user.avatar_url,
      },
    }));

    // Construct the repository data response
    const repositoryData: RepositoryData = {
      id: repoData.id,
      name: repoData.name,
      full_name: repoData.full_name,
      description: repoData.description,
      private: repoData.private,
      html_url: repoData.html_url,
      stargazers_count: repoData.stargazers_count,
      watchers_count: repoData.watchers_count,
      forks_count: repoData.forks_count,
      open_issues_count: repoData.open_issues_count,
      default_branch: repoData.default_branch,
      language: repoData.language,
      topics: repoData.topics || [],
      created_at: repoData.created_at,
      updated_at: repoData.updated_at,
      contributors,
      recent_issues,
    };

    return NextResponse.json({
      message: "Repository data retrieved successfully",
      data: repositoryData,
    });

  } catch (error: unknown) {
    console.error("Error fetching repository data:", error);

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response
    ) {
      const status = error.response.status as number;
      if (status === 401) {
        return NextResponse.json({ error: "GitHub token expired or invalid" }, { status: 401 });
      } else if (status === 404) {
        return NextResponse.json({ error: "Repository not found or no access" }, { status: 404 });
      } else if (status === 403) {
        return NextResponse.json({ error: "GitHub API rate limit exceeded" }, { status: 403 });
      }
    }

    return NextResponse.json({ error: "Failed to fetch repository data" }, { status: 500 });
  }
}