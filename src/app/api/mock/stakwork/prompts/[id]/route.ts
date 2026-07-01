import { NextRequest, NextResponse } from "next/server";
import { mockPromptsStore } from "../store";

// ── GET /api/mock/stakwork/prompts/[id] ────────────────────────────────────────
// Returns full prompt detail including `value`.
// Shape: { success: true, data: { ...prompt } }
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id, 10);
    const prompt = mockPromptsStore.get(promptId);

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: prompt });
  } catch (error) {
    console.error("Error fetching mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch prompt" },
      { status: 500 }
    );
  }
}

// ── PUT /api/mock/stakwork/prompts/[id] ────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id, 10);
    const body = await request.json();

    // Accept prompt wrapped or unwrapped (Hive sends { prompt: {...}, hive_version_id })
    const promptPayload = body.prompt ?? body;
    const hiveVersionId: string | undefined = body.hive_version_id;

    const existing = mockPromptsStore.get(promptId);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    const updated = {
      ...existing,
      name: promptPayload.name ?? existing.name,
      value: promptPayload.value ?? existing.value,
      description: promptPayload.description ?? existing.description,
      hive_version_id: hiveVersionId ?? existing.hive_version_id ?? null,
      current_version_id: (existing.current_version_id ?? 0) + 1,
      // published_version_id is not changed on save — only updated by publish action
      updated_at: new Date().toISOString(),
    };

    mockPromptsStore.set(promptId, updated);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update prompt" },
      { status: 500 }
    );
  }
}

// ── DELETE /api/mock/stakwork/prompts/[id] ─────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id, 10);

    if (!mockPromptsStore.has(promptId)) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    mockPromptsStore.delete(promptId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
