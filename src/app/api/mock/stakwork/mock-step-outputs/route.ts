import { NextRequest, NextResponse } from "next/server";
import { mockStore, makeUpsertKey, MockStepOutput } from "./store";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get("workflow_id");
  const workflowVersionId = searchParams.get("workflow_version_id");

  if (!workflowId) {
    return NextResponse.json(
      { success: false, error: "workflow_id is required" },
      { status: 400 }
    );
  }

  const filtered = mockStore.filter((entry) => {
    if (entry.workflow_id !== workflowId) return false;
    if (workflowVersionId) {
      // Return entries matching the given version OR entries with no version (null)
      return entry.workflow_version_id === workflowVersionId || entry.workflow_version_id === null;
    }
    return true;
  });

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support both nested (mock_step_output: {...}) and flat body shapes
    const payload = body.mock_step_output ?? body;
    const { workflow_id, step_id, workflow_version_id, output } = payload;

    if (!workflow_id) {
      return NextResponse.json(
        { success: false, error: "workflow_id is required" },
        { status: 422 }
      );
    }
    if (!step_id) {
      return NextResponse.json(
        { success: false, error: "step_id is required" },
        { status: 422 }
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

    const versionId: string | null = workflow_version_id ?? null;
    const upsertKey = makeUpsertKey(workflow_id, step_id, versionId);

    const existingIndex = mockStore.findIndex(
      (e) => makeUpsertKey(e.workflow_id, e.step_id, e.workflow_version_id) === upsertKey
    );

    const now = new Date().toISOString();

    if (existingIndex !== -1) {
      // Upsert: update in place
      mockStore[existingIndex] = {
        ...mockStore[existingIndex],
        output,
        updated_at: now,
      };
      return NextResponse.json({ success: true, data: mockStore[existingIndex] });
    }

    const newEntry: MockStepOutput = {
      id: `mock-mso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      workflow_id,
      step_id,
      workflow_version_id: versionId,
      output,
      created_at: now,
      updated_at: now,
    };

    mockStore.push(newEntry);

    return NextResponse.json({ success: true, data: newEntry }, { status: 201 });
  } catch (error) {
    console.error("Error in mock POST mock_step_outputs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create mock step output" },
      { status: 500 }
    );
  }
}
