import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getStakworkRunById } from "@/services/stakwork-run";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * GET /api/stakwork/runs/[runId]
 * Fetch a single Stakwork run by ID, including its full `result` blob.
 * IDOR-safe: access is enforced by construction via a single authorized-workspace
 * WHERE clause — unauthorized and cross-workspace IDs both resolve to 404 (not 403).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // Authenticate before any DB read
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const userId = userOrResponse.id;

  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    // Single authorized query — null means "not found" OR "not your run"; both → 404
    const run = await getStakworkRunById(runId, userId);

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, run }, { status: 200 });
  } catch (error) {
    console.error("Error fetching run by id:", error);
    return NextResponse.json(
      { error: "Failed to fetch run" },
      { status: 500 }
    );
  }
}
