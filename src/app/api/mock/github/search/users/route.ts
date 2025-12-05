import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Search Users Endpoint
 * 
 * Simulates: GET https://api.github.com/search/users
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/search#search-users",
        },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q") || "";
    const perPage = parseInt(searchParams.get("per_page") || "30", 10);
    const page = parseInt(searchParams.get("page") || "1", 10);

    if (!query) {
      return NextResponse.json(
        {
          message: "Validation Failed",
          errors: [{ message: "q parameter is required" }],
          documentation_url: "https://docs.github.com/rest/search#search-users",
        },
        { status: 422 }
      );
    }

    let users = mockGitHubState.searchUsers(query);
    
    // If no users found, auto-create one matching the query
    if (users.length === 0) {
      mockGitHubState.createUser(query, "User");
      users = mockGitHubState.searchUsers(query);
    }

    // Pagination
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paginatedUsers = users.slice(start, end);

    return NextResponse.json({
      total_count: users.length,
      incomplete_results: false,
      items: paginatedUsers,
    });
  } catch (error) {
    console.error("Mock GitHub search users error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
