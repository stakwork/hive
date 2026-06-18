import { NextRequest, NextResponse } from "next/server";

type RouteParams = {
  params: Promise<{ promptId: string; versionId: string }>;
};

const SEEDED_RUNS: Record<string, { status: string; result: string | null; evalSetId: string }> = {
  "1": { status: "COMPLETED", result: '{"pass":8,"fail":2,"total":10}', evalSetId: "eval-set-1" },
  "2": { status: "IN_PROGRESS", result: null, evalSetId: "eval-set-2" },
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
  return NextResponse.json({ success: true, data: run });
}
