import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub OAuth Token Exchange Endpoint
 * 
 * Simulates: POST https://github.com/login/oauth/access_token
 * 
 * Handles both:
 * - Authorization code exchange
 * - Refresh token flow
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      client_id,
      client_secret,
      code,
      grant_type = "authorization_code",
      refresh_token,
      scope = "repo,user,read:org",
    } = body;

    // Validate required fields
    if (!client_id || !client_secret) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "Missing required parameters",
        },
        { status: 400 }
      );
    }

    let token;

    if (grant_type === "refresh_token" && refresh_token) {
      // Refresh token flow
      token = mockGitHubState.refreshToken(refresh_token);
      if (!token) {
        return NextResponse.json(
          {
            error: "invalid_grant",
            error_description: "Invalid refresh token",
          },
          { status: 401 }
        );
      }
    } else if (code) {
      // Authorization code flow
      token = mockGitHubState.createToken(code, scope);
    } else {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "Missing code or refresh_token",
        },
        { status: 400 }
      );
    }

    // Return token response matching GitHub's format
    return NextResponse.json({
      access_token: token.access_token,
      expires_in: token.expires_in,
      refresh_token: token.refresh_token,
      refresh_token_expires_in: token.refresh_token_expires_in,
      scope: token.scope,
      token_type: token.token_type,
    });
  } catch (error) {
    console.error("Mock GitHub OAuth error:", error);
    return NextResponse.json(
      {
        error: "server_error",
        error_description: "Internal server error",
      },
      { status: 500 }
    );
  }
}
