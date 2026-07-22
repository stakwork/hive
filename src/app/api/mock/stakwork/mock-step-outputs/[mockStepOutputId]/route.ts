import { NextRequest, NextResponse } from "next/server";

// Re-use the same in-memory store from the parent mock route so GET list and
// GET/PUT/DELETE by-id operate on the same data during a single server process.
// Dynamic import is not viable here (circular + Next.js module caching handles
// it for us), so we keep a separate exported store that both files reference.
// The list route also exports `mockStore` so we can import it directly.
import { mockStore } from "../store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const { mockStepOutputId } = await params;

    const entry = mockStore.find((e) => e.id === mockStepOutputId);

    if (!entry) {
      return NextResponse.json(
        { success: false, error: "Resource not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    console.error("Error fetching mock step output by id:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch mock step output" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const { mockStepOutputId } = await params;
    const body = await request.json();

    // Support both nested and flat body shapes (proxy sends flat)
    const payload = body.mock_step_output ?? body;

    const index = mockStore.findIndex((e) => e.id === mockStepOutputId);

    if (index === -1) {
      return NextResponse.json(
        { success: false, error: "Resource not found" },
        { status: 404 }
      );
    }

    if (!("output" in payload)) {
      return NextResponse.json(
        {
          success: false,
          error: "output cannot be blank. Use DELETE to remove a mock.",
        },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();
    mockStore[index] = {
      ...mockStore[index],
      workflow_id: payload.workflow_id ?? mockStore[index].workflow_id,
      step_id: payload.step_id ?? mockStore[index].step_id,
      workflow_version_id:
        "workflow_version_id" in payload
          ? (payload.workflow_version_id ?? null)
          : mockStore[index].workflow_version_id,
      output: payload.output,
      updated_at: now,
    };

    return NextResponse.json({ success: true, data: mockStore[index] });
  } catch (error) {
    console.error("Error updating mock step output by id:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update mock step output" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const { mockStepOutputId } = await params;

    const index = mockStore.findIndex((e) => e.id === mockStepOutputId);

    if (index === -1) {
      return NextResponse.json(
        { success: false, error: "Resource not found" },
        { status: 404 }
      );
    }

    mockStore.splice(index, 1);

    return NextResponse.json({
      success: true,
      data: "Mock step output deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting mock step output by id:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete mock step output" },
      { status: 500 }
    );
  }
}
