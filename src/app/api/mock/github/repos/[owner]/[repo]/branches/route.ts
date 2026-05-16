import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List Repository Branches Endpoint
 * 
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}/branches
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
          documentation_url: "https://docs.github.com/rest/branches/branches",
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

    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10));
    const perPage = Math.max(1, parseInt(request.nextUrl.searchParams.get("per_page") ?? "100", 10));

    const allBranches = mockGitHubState.getBranches(owner, repo);
    const start = (page - 1) * perPage;
    const branches = allBranches.slice(start, start + perPage);
    return NextResponse.json(branches);
  } catch (error) {
    console.error("Mock GitHub branches error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
