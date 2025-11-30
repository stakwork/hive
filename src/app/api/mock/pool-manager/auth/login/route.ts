import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../state";

/**
 * Mock Pool Manager Authentication
 * POST /api/mock/pool-manager/auth/login
 */
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Username and password required" },
        { status: 400 }
      );
    }

    const token = poolManagerState.authenticateUser(username, password);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      token,
      message: `Authenticated as ${username}`,
    });
  } catch (error) {
    console.error("Mock Pool Manager auth error:", error);
    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 }
    );
  }
}