import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List User Repositories Endpoint
 * 
 * Simulates: GET https://api.github.com/user/repos
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/repos/repos",
        },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const sort = searchParams.get("sort") || "created";
    const direction = searchParams.get("direction") || "desc";
    const perPage = parseInt(searchParams.get("per_page") || "30", 10);
    const page = parseInt(searchParams.get("page") || "1", 10);

    // Get user from token (mock-user for testing)
    const token = authHeader.replace("Bearer ", "");
    const login = token.includes("mock") ? "mock-user" : "test-user";
    
    // Ensure user exists
    mockGitHubState.createUser(login, "User");
    
    // Get or create repositories for this user
    let repositories = mockGitHubState.getRepositoriesByOwner(login);
    
    // If no repositories exist, auto-create a default one
    if (repositories.length === 0) {
      mockGitHubState.createRepository(login, "test-repo", false, "main");
      repositories = mockGitHubState.getRepositoriesByOwner(login);
    }

    // Sort repositories
    if (sort === "created") {
      repositories.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return direction === "desc" ? dateB - dateA : dateA - dateB;
      });
    }

    // Pagination
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paginatedRepos = repositories.slice(start, end);

    return NextResponse.json(paginatedRepos);
  } catch (error) {
    console.error("Mock GitHub user repos error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
