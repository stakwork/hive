import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List Repository Commits Endpoint
 * 
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}/commits
 * Supports pagination via per_page and page query parameters
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
          documentation_url: "https://docs.github.com/rest/commits/commits",
        },
        { status: 401 }
      );
    }

    const { owner, repo } = await params;
    const searchParams = request.nextUrl.searchParams;
    
    const perPage = parseInt(searchParams.get("per_page") || "30", 10);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const sha = searchParams.get("sha");
    
    // Ensure repository exists
    let repository = mockGitHubState.getRepository(owner, repo);
    if (!repository) {
      repository = mockGitHubState.createRepository(owner, repo);
    }

    const commits = mockGitHubState.getCommits(owner, repo);
    
    // Filter by SHA if provided (simulates branch filtering)
    if (sha) {
      // In real API, this would filter by branch
      // For mock, we just return the same commits
    }

    // Pagination
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paginatedCommits = commits.slice(start, end);
    
    // Add Link header for pagination
    const totalPages = Math.ceil(commits.length / perPage);
    const linkHeader = [];
    
    if (page < totalPages) {
      linkHeader.push(`<${request.nextUrl.origin}${request.nextUrl.pathname}?page=${page + 1}&per_page=${perPage}>; rel="next"`);
      linkHeader.push(`<${request.nextUrl.origin}${request.nextUrl.pathname}?page=${totalPages}&per_page=${perPage}>; rel="last"`);
    }
    
    const headers: Record<string, string> = {};
    if (linkHeader.length > 0) {
      headers.Link = linkHeader.join(", ");
    }

    return NextResponse.json(paginatedCommits, { headers });
  } catch (error) {
    console.error("Mock GitHub commits error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
