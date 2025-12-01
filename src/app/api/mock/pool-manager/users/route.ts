import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager user creation endpoint
 * POST /api/mock/pool-manager/users
 * Response format matches PoolUserResponse type
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    try {
      const user = mockPoolState.createUser(username, password);
      const token = mockPoolState.login(username, password);

      return NextResponse.json({
        message: `User '${username}' created successfully`,
        success: true,
        user: {
          authentication_token: token,
          created_at: user.createdAt.toISOString(),
          email: email || `${username}@mock.dev`,
          is_active: true,
          last_login: null,
          pool_count: 0,
          pools: [],
          username: user.username,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Mock Pool Manager create user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
