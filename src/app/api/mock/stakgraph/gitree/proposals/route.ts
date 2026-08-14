import { NextRequest, NextResponse } from "next/server";
import { mockProposals, VALID_STATUSES, ProposalStatus } from "./fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Proposals List Endpoint
 *
 * GET — Returns the mutable in-memory proposal list, with optional filtering.
 *
 * Gated: presence-only x-api-token check (never reachable in production builds
 * since USE_MOCKS is false in production).
 */
export async function GET(request: NextRequest) {
  const apiToken = request.headers.get("x-api-token");
  if (!apiToken) {
    return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repoFilter = searchParams.get("repo");
  const statusFilter = searchParams.get("status");

  if (statusFilter && !VALID_STATUSES.includes(statusFilter as ProposalStatus)) {
    return NextResponse.json(
      {
        error: `Invalid status value. Allowed values: ${VALID_STATUSES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  let filtered = [...mockProposals];

  if (repoFilter) {
    filtered = filtered.filter((p) => p.repo === repoFilter);
  }

  if (statusFilter) {
    filtered = filtered.filter((p) => p.status === statusFilter);
  }

  // The real swarm returns repo: "all" when no repo filter is given.
  return NextResponse.json({
    proposals: filtered,
    count: filtered.length,
    repo: repoFilter ?? "all",
  });
}
