import { NextRequest, NextResponse } from "next/server";
import { mockPromptsStore, mockVersionRunCounts } from "../store";

/**
 * Mock: GET /api/mock/stakwork/prompts/find_by_version?name=<name>&hive_version_id=<id>
 *
 * Mirrors the real Stakwork endpoint shape:
 *   200 → { notation, run_count }
 *   404 → { error: "Not found" }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const hiveVersionId = searchParams.get("hive_version_id");

  if (!name || !hiveVersionId) {
    return NextResponse.json({ error: "name and hive_version_id are required" }, { status: 400 });
  }

  // Check mock version run count store first (explicit overrides)
  const versionData = mockVersionRunCounts.get(hiveVersionId);
  if (versionData) {
    // Validate name matches what's recorded for this version
    const promptEntry = Array.from(mockPromptsStore.values()).find((p) => p.name === name);
    if (!promptEntry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ notation: versionData.notation, run_count: versionData.run_count });
  }

  // Fall back: find prompt by name and return its run_count (version-level detail not tracked)
  const prompt = Array.from(mockPromptsStore.values()).find((p) => p.name === name);
  if (!prompt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notation: `${prompt.name}@v${prompt.current_version_id}`,
    run_count: prompt.run_count ?? 0,
  });
}
