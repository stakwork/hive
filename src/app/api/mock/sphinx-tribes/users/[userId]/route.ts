import { NextRequest, NextResponse } from "next/server";
import { mockSphinxTribesState } from "@/lib/mock/sphinx-tribes-state";
import { config } from "@/config/env";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function validateMockMode() {
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      {
        success: false,
        error: "Mock endpoints only available when USE_MOCKS=true",
      },
      { status: 403 }
    );
  }
  return null;
}

// GET /api/mock/sphinx-tribes/users/:userId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const { userId } = await params;

    let user = mockSphinxTribesState.getUser(userId);

    // Auto-create if not exists
    if (!user) {
      user = mockSphinxTribesState.createUser({
        id: userId,
        owner_alias: `User ${userId}`,
      });
    }

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes get user error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
