import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List User Installations Endpoint
 * 
 * Simulates: GET https://api.github.com/user/installations
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/apps/installations",
        },
        { status: 401 }
      );
    }

    // Auto-create an installation for mock user
    const installation = mockGitHubState.createInstallation("mock-user");
    
    return NextResponse.json({
      total_count: 1,
      installations: [installation],
    });
  } catch (error) {
    console.error("Mock GitHub installations error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}
