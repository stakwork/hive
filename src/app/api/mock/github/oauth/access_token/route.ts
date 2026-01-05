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
    // Handle both JSON and form-urlencoded requests (NextAuth uses form-urlencoded)
    const contentType = request.headers.get("content-type") || "";
    let params: Record<string, string>;

    if (contentType.includes("application/json")) {
      params = await request.json();
    } else {
      // Parse as form-urlencoded (default for OAuth token requests)
      const text = await request.text();
      params = Object.fromEntries(new URLSearchParams(text));
    }

    const {
      code,
      grant_type = "authorization_code",
      refresh_token,
      scope = "repo,user,read:org",
    } = params;

    // In mock mode, be lenient with client validation
    // Real GitHub validates these, but for mock we just need the code
    if (!code && !refresh_token) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "Missing code or refresh_token",
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
      const result = mockGitHubState.exchangeAuthCode(code);
      if (!result) {
        // Code not found - auto-create token for backwards compatibility
        // (allows direct token creation without authorize flow)
        token = mockGitHubState.createToken(code, scope);
      } else {
        token = result.token;
      }
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
