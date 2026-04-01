import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { serviceConfigs } from "@/config/services";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get("repoUrl");
  const workspaceSlug = searchParams.get("workspaceSlug");

  const parsedPage = parseInt(searchParams.get("page") ?? "", 10);
  const parsedPerPage = parseInt(searchParams.get("per_page") ?? "", 10);
  const resolvedPage = isNaN(parsedPage) ? 1 : parsedPage;
  const resolvedPerPage = isNaN(parsedPerPage) ? 100 : parsedPerPage;

  if (!repoUrl) {
    return NextResponse.json({ error: "Repo URL is required" }, { status: 400 });
  }

  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug || undefined);
    if (!githubProfile?.token) {
      return NextResponse.json({ error: "GitHub access token not found" }, { status: 400 });
    }
    const pat = githubProfile.token;

    const { owner, repo } = parseGithubOwnerRepo(repoUrl);

    const res = await axios.get(`${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/branches`, {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        per_page: resolvedPerPage,
        page: resolvedPage,
      },
    });

    const branches = res.data.map((branch: { name: string; commit: { sha: string } }) => ({
      name: branch.name,
      sha: branch.commit.sha,
    }));

    return NextResponse.json({
      branches,
      total_count: branches.length,
      current_page: resolvedPage,
      per_page: resolvedPerPage,
    });
  } catch (error: unknown) {
    console.error("Error fetching branches:", error);

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

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      error.response.status === 404
    ) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to fetch branches" }, { status: 500 });
  }
}
