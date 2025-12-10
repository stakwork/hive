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

// GET /api/mock/sphinx-tribes/bounties/code/:bountyCode
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bountyCode: string }> }
) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const { bountyCode } = await params;

    let bounty = mockSphinxTribesState.getBountyByCode(bountyCode);

    // Auto-create if not exists
    if (!bounty) {
      bounty = mockSphinxTribesState.createBounty({
        title: `Bounty ${bountyCode}`,
        description: `Auto-generated bounty for code: ${bountyCode}`,
        bounty_code: bountyCode,
      });
    }

    return NextResponse.json({
      success: true,
      data: bounty,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes get bounty by code error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
