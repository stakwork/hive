import { NextRequest, NextResponse } from "next/server";

/**
 * Mock POST /api/protect/webhook
 *
 * Completes a Protect review under USE_MOCKS without a live Stakwork run.
 * The real handler at /api/protect/webhook remains the production path;
 * this mock exists so local Protect reviews can finish against Jarvis fixtures.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  return NextResponse.json({
    success: true,
    runId: typeof body.runId === "string" ? body.runId : "mock-protect-run",
    status: "completed",
    counts: { created: 0, updated: 0, skipped: 0, stale: 0 },
  });
}
