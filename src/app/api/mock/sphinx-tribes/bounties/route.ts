import { NextRequest, NextResponse } from "next/server";
import { mockSphinxTribesState } from "@/lib/mock/sphinx-tribes-state";
import { config } from "@/config/env";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Only allow in mock mode
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

// POST /api/mock/sphinx-tribes/bounties - Create a new bounty
export async function POST(request: NextRequest) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const body = await request.json();
    const {
      title,
      description,
      owner_id,
      price,
      assignee,
      github_description,
      hive_task_id,
      bounty_code,
      estimated_completion_hours,
    } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      );
    }

    // Auto-create bounty
    const bounty = mockSphinxTribesState.createBounty({
      title,
      description,
      owner_id: owner_id || "1", // Default to first user
      price: price || 1000,
      assignee: assignee || "",
      github_description,
      hive_task_id,
      bounty_code,
      estimated_completion_hours,
    });

    return NextResponse.json({
      success: true,
      data: bounty,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes create bounty error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/mock/sphinx-tribes/bounties - List bounties
export async function GET(request: NextRequest) {
  const mockModeError = validateMockMode();
  if (mockModeError) return mockModeError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const owner_id = searchParams.get("owner_id") || undefined;

    const bounties = mockSphinxTribesState.listBounties({
      status,
      owner_id,
    });

    return NextResponse.json({
      success: true,
      data: bounties,
    });
  } catch (error) {
    console.error("Mock Sphinx Tribes list bounties error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
