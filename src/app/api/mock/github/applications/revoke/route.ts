import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { MockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Applications Revoke Token Endpoint
 * 
 * Simulates: DELETE https://api.github.com/applications/revoke
 * 
 * This endpoint revokes a user's OAuth access token, typically called
 * when a user disconnects their GitHub account.
 */
export async function DELETE(request: NextRequest) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { message: "Not found" },
      { status: 404 }
    );
  }

  try {
    // Verify Basic Auth (GitHub App Client ID:Secret)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return NextResponse.json(
        { message: "Requires authentication" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { access_token } = body;

    if (!access_token) {
      return NextResponse.json(
        { message: "access_token is required" },
        { status: 422 }
      );
    }

    // Revoke the token in mock state
    const mockState = MockGitHubState.getInstance();
    const revoked = mockState.revokeToken(access_token);

    if (!revoked) {
      // GitHub API returns 404 if token doesn't exist or already revoked
      return NextResponse.json(
        { message: "Not Found" },
        { status: 404 }
      );
    }

    // Successful revocation returns 204 No Content (GitHub API behavior)
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Mock GitHub] Error revoking token:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}