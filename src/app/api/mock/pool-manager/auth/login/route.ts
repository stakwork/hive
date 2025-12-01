import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager authentication endpoint
 * POST /api/mock/pool-manager/auth/login
 * Response format matches PoolManagerAuthResponse type
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    // Try to login with existing user
    let token = mockPoolState.login(username, password);

    if (!token) {
      // Create user if doesn't exist and try again
      try {
        mockPoolState.createUser(username, password);
        token = mockPoolState.login(username, password);
      } catch {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      token,
    });
  } catch (error) {
    console.error("Mock Pool Manager login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
