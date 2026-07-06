import { NextRequest, NextResponse } from "next/server";

type RouteParams = {
  params: Promise<{ promptId: string; versionId: string }>;
};

// Keyed by cuid-style version ids matching what mockSeedData.ts seeds for prompt versions.
// These are intentionally generic patterns — in mock mode, any versionId not in this map
// returns data: null (no run yet), which is the correct default.
const SEEDED_RUNS: Record<string, { status: string; result: string | null; evalSetId: string }> = {
  "mock-version-id-1": {
    status: "COMPLETED",
    result: '{"pass":8,"fail":2,"total":10}',
    evalSetId: "eval-set-1",
  },
  "mock-version-id-2": {
    status: "IN_PROGRESS",
    result: null,
    evalSetId: "eval-set-2",
  },
};

/**
 * POST /api/mock/prompts/[promptId]/versions/[versionId]/run-evals
 * Returns a fixed success response simulating a dispatched eval job.
 */
export async function POST(_request: NextRequest, _context: RouteParams) {
  return NextResponse.json({ success: true, runId: "mock-run-1", projectId: 999 });
}

/**
 * GET /api/mock/prompts/[promptId]/versions/[versionId]/run-evals
 * Returns seeded eval run state keyed by versionId.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { versionId } = await params;
  const run = SEEDED_RUNS[versionId] ?? null;
  const history = run ? [run] : [];
  return NextResponse.json({ success: true, data: run, history });
}
