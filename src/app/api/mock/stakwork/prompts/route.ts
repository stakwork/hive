import { NextRequest, NextResponse } from "next/server";
import { mockPromptsStore } from "./store";
export type { MockPromptEntry } from "./store";

// ── GET /api/mock/stakwork/prompts ─────────────────────────────────────────────
// Returns a Pagy-style paginated list (slim — no `value` field).
// Shape: { data: { total, size, prompts: [...slim] } }
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const PAGE_SIZE = 20;

  const all = Array.from(mockPromptsStore.values());
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = all.slice(start, start + PAGE_SIZE);

  // Slim list shape — no `value`
  const slim = pageItems.map(({ id, name, description, usage_notation, run_count }) => ({
    id,
    name,
    description,
    usage_notation,
    run_count,
  }));

  return NextResponse.json({
    success: true,
    data: {
      total: all.length,
      size: pageItems.length,
      prompts: slim,
    },
  });
}

// ── POST /api/mock/stakwork/prompts ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.json();

  const PROMPT_NAME_REGEX = /^[A-Z_]+$/;
  if (!body.name || !PROMPT_NAME_REGEX.test(body.name)) {
    return NextResponse.json(
      { error: "Prompt name must contain only uppercase letters and underscores" },
      { status: 400 }
    );
  }

  const newId = Math.max(0, ...mockPromptsStore.keys()) + 1;
  const newVersionId = newId * 10;

  const newPrompt = {
    id: newId,
    name: body.name,
    value: body.value ?? "",
    description: body.description ?? "",
    current_version_id: newVersionId,
    published_version_id: newVersionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hive_version_id: body.hive_version_id ?? null,
  };

  mockPromptsStore.set(newId, newPrompt);

  return NextResponse.json({
    success: true,
    data: newPrompt,
  });
}
