import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockProposals } from "../../fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Proposal Reject Endpoint
 *
 * POST — Rejects a pending proposal, mutating its status in-place.
 *
 * Returns (matching the swarm contract):
 *   200 { status: "success", proposal }                 — rejected
 *   409 { error, status: "accepted" | "rejected" }      — already decided
 *   404 { error }                                       — proposal not found
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!config.USE_MOCKS) {
    return NextResponse.json({ error: "Mock endpoints are disabled" }, { status: 404 });
  }

  const apiToken = request.headers.get("x-api-token");
  if (!apiToken) {
    return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
  }

  const { id } = await params;
  const proposal = mockProposals.find((p) => p.id === id);

  if (!proposal) {
    return NextResponse.json({ error: `Proposal '${id}' not found` }, { status: 404 });
  }

  if (proposal.status !== "pending") {
    return NextResponse.json(
      {
        error: `Proposal ${proposal.id} was already ${proposal.status}`,
        status: proposal.status,
      },
      { status: 409 },
    );
  }

  let decidedBy: string | undefined;
  let reason: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.decidedBy === "string") decidedBy = body.decidedBy;
    if (typeof body?.reason === "string") reason = body.reason;
  } catch {
    // body is optional
  }

  // Mutate in place
  proposal.status = "rejected";
  proposal.decidedBy = decidedBy;
  proposal.decidedAt = new Date().toISOString();
  if (reason !== undefined) proposal.decisionReason = reason;

  return NextResponse.json({ status: "success", proposal });
}
