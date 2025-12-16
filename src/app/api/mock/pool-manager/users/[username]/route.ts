import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager user deletion endpoint
 * DELETE /api/mock/pool-manager/users/[username]
 */

interface RouteContext {
  params: Promise<{
    username: string;
  }>;
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { username } = await context.params;

    const deleted = mockPoolState.deleteUser(username);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${username} deleted`,
    });
  } catch (error) {
    console.error("Mock Pool Manager delete user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
