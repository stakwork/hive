import { NextRequest, NextResponse } from "next/server";
import { mockProposals, mockConceptDocs } from "../../fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Proposal Accept Endpoint
 *
 * POST — Accepts a pending proposal, mutating its status in-place.
 *
 * Returns:
 *   200 { status: "success", proposal }                — accepted
 *   409 { code: "stale_base", conceptId }              — baseDocs mismatch + force not set
 *   409 { status: "accepted" | "rejected" }            — already decided
 *   404                                                — proposal not found
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiToken = request.headers.get("x-api-token");
  if (!apiToken) {
    return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
  }

  const { id } = await params;
  const proposal = mockProposals.find((p) => p.id === id);

  if (!proposal) {
    return NextResponse.json({ error: `Proposal '${id}' not found` }, { status: 404 });
  }

  // Already decided — return 409 { status } with no `error` field (matches swarm contract)
  if (proposal.status !== "pending") {
    return NextResponse.json({ status: proposal.status }, { status: 409 });
  }

  let force = false;
  let decidedBy: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.force === "boolean") force = body.force;
    if (typeof body?.decidedBy === "string") decidedBy = body.decidedBy;
  } catch {
    // body is optional
  }

  // Stale-base check: for proposals with a conceptId and baseDocs, compare
  // baseDocs against the current mock concept documentation.
  if (!force && proposal.conceptId && proposal.baseDocs !== undefined) {
    const currentDocs = mockConceptDocs[proposal.conceptId];
    if (currentDocs !== undefined && proposal.baseDocs !== currentDocs) {
      return NextResponse.json(
        { code: "stale_base", conceptId: proposal.conceptId },
        { status: 409 },
      );
    }
  }

  // Mutate in place
  proposal.status = "accepted";
  proposal.decidedBy = decidedBy;
  proposal.decidedAt = new Date().toISOString();

  // Stamp createdConceptId for create proposals
  if (proposal.action === "create") {
    proposal.createdConceptId = `stakwork/hive/${(proposal.name ?? "new-concept")
      .toLowerCase()
      .replace(/\s+/g, "-")}`;
  }

  return NextResponse.json({ status: "success", proposal });
}
