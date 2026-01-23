import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List Pull Requests Endpoint
 * 
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}/pulls
 * 
 * Query parameters:
 * - state: Filter by state (open, closed, all). Default: open
 * - per_page: Results per page (max 100). Default: 30
 * - page: Page number. Default: 1
 * - sort: Sort by created, updated, popularity, long-running. Default: created
 * - direction: Sort direction (asc, desc). Default: desc
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/pulls/pulls",
        },
        { status: 401 }
      );
    }

    const { owner, repo } = await params;
    
    // Ensure repository exists
    let repository = mockGitHubState.getRepository(owner, repo);
    if (!repository) {
      repository = mockGitHubState.createRepository(owner, repo);
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const state = (searchParams.get("state") || "open") as "open" | "closed" | "all";
    const perPage = Math.min(parseInt(searchParams.get("per_page") || "30"), 100);
    const page = parseInt(searchParams.get("page") || "1");
    const sort = (searchParams.get("sort") || "created") as "created" | "updated";
    const direction = (searchParams.get("direction") || "desc") as "asc" | "desc";

    // Get filtered PRs
    const allPRs = mockGitHubState.getPullRequests(owner, repo, {
      state,
      sort,
      direction,
    });

    // Apply pagination
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedPRs = allPRs.slice(startIndex, endIndex);

    return NextResponse.json(paginatedPRs);
  } catch (error) {
    console.error("Mock GitHub pulls error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
