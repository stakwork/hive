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

// GET /api/mock/sphinx-tribes/bounties/:bountyId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const { bountyId } = await params;

    // Auto-create if not exists (for resilience)
    let bounty = mockSphinxTribesState.getBounty(bountyId);

    if (!bounty) {
      bounty = mockSphinxTribesState.createBounty({
        id: bountyId,
        title: `Auto-generated Bounty ${bountyId}`,
        description: "This bounty was auto-created by the mock system",
      });
    }

    return NextResponse.json({
      success: true,
      data: bounty,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes get bounty error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/mock/sphinx-tribes/bounties/:bountyId
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const { bountyId } = await params;
    const body = await request.json();

    const bounty = mockSphinxTribesState.updateBounty(bountyId, body);

    if (!bounty) {
      return NextResponse.json(
        { success: false, error: "Bounty not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: bounty,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes update bounty error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
