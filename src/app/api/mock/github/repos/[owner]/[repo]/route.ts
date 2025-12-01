import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Get Repository Endpoint
 * 
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}
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
          documentation_url: "https://docs.github.com/rest/repos/repos",
        },
        { status: 401 }
      );
    }

    const { owner, repo } = await params;
    
    // Auto-create repository if it doesn't exist
    let repository = mockGitHubState.getRepository(owner, repo);
    if (!repository) {
      repository = mockGitHubState.createRepository(owner, repo);
    }

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Mock GitHub repository error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
