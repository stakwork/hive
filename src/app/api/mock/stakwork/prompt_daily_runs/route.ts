import { NextRequest, NextResponse } from "next/server";
import { mockPromptDailyRunsStore } from "./store";
export type { MockPromptDailyRunEntry } from "./store";

const PAGE_SIZE = 20;

// ── GET /api/mock/stakwork/prompt_daily_runs ───────────────────────────────────
// Query params:
//   run_date  — YYYY-MM-DD to filter by (required in production; defaults to today in mock)
//   page      — 1-based page number (default: 1)
//
// Response envelope (matches real Stakwork contract):
//   { success: true, data: { total, size, prompt_daily_runs: [...] } }
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runDate = searchParams.get("run_date") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  const filtered = runDate
    ? mockPromptDailyRunsStore.filter((row) => row.run_date === runDate)
    : mockPromptDailyRunsStore;

  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  return NextResponse.json({
    success: true,
    data: {
      total,
      size: pageItems.length,
      prompt_daily_runs: pageItems,
    },
  });
}
