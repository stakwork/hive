import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Get Authenticated User Endpoint
 * 
 * Simulates: GET https://api.github.com/user
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/reference/users#get-the-authenticated-user",
        },
        { status: 401 }
      );
    }

    // Extract user from token (in mock, we just use a default user)
    // In real implementation, token would map to specific user
    const token = authHeader.replace("Bearer ", "");
    
    // Auto-create a mock user for this token
    const login = token.includes("mock") ? "mock-user" : "test-user";
    const user = mockGitHubState.createUser(login, "User");

    return NextResponse.json(user);
  } catch (error) {
    console.error("Mock GitHub user error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
