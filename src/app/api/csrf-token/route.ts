import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { createCSRFToken } from "@/lib/csrf";

/**
 * GET /api/csrf-token
 * 
 * Returns a CSRF token for the current authenticated user session.
 * This token must be included in state-changing API requests.
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session token
    const token = await getToken({ 
      req: request, 
      secret: process.env.NEXTAUTH_SECRET 
    });

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Generate CSRF token for the user
    const csrfToken = await createCSRFToken(token.sub as string);

    return NextResponse.json({
      csrfToken,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    });

  } catch (error) {
    console.error("CSRF token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate CSRF token" },
      { status: 500 }
    );
  }
}
