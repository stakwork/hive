import { NextRequest, NextResponse } from "next/server";
import { mockProposals, mockConceptDocs } from "../../fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Proposal Accept Endpoint
 *
 * POST — Accepts a pending proposal, mutating its status in-place and applying
 * the proposed change to the mock concept docs (mirroring the real swarm,
 * where accept writes through to the Concept graph).
 *
 * Returns (matching the swarm contract):
 *   200 { status: "success", proposal }                       — accepted
 *   409 { error, code: "stale_base", conceptId }              — docs drifted + force not set
 *   409 { error, status: "accepted" | "rejected" }            — already decided
 *   404 { error }                                             — proposal not found
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

  if (proposal.status !== "pending") {
    return NextResponse.json(
      {
        error: `Proposal ${proposal.id} was already ${proposal.status}`,
        status: proposal.status,
      },
      { status: 409 },
    );
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

  // Stale-base check against the concept being EDITED: the target for
  // update/delete, the SURVIVOR for merge (matching the real swarm — drift
  // on the absorbed concept doesn't matter, it's being deleted).
  const staleTargetId =
    proposal.action === "merge" ? proposal.mergeIntoConceptId : proposal.conceptId;
  if (!force && staleTargetId && proposal.baseDocs !== undefined) {
    const currentDocs = mockConceptDocs[staleTargetId];
    if (currentDocs !== undefined && proposal.baseDocs !== currentDocs) {
      return NextResponse.json(
        {
          error: `Documentation of concept ${staleTargetId} has changed since this proposal was created; re-review or pass force=true`,
          code: "stale_base",
          conceptId: staleTargetId,
        },
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

  // Apply the accepted change to the mock concept docs, like the real swarm
  // applies it to the Concept graph.
  switch (proposal.action) {
    case "create":
      if (proposal.createdConceptId) {
        mockConceptDocs[proposal.createdConceptId] = proposal.documentation ?? "";
      }
      break;
    case "update":
      if (proposal.conceptId && proposal.documentation !== undefined) {
        mockConceptDocs[proposal.conceptId] = proposal.documentation;
      }
      break;
    case "delete":
      if (proposal.conceptId) {
        delete mockConceptDocs[proposal.conceptId];
      }
      break;
    case "merge":
      if (proposal.mergeIntoConceptId && proposal.documentation !== undefined) {
        mockConceptDocs[proposal.mergeIntoConceptId] = proposal.documentation;
      }
      if (proposal.conceptId) {
        delete mockConceptDocs[proposal.conceptId];
      }
      break;
  }

  return NextResponse.json({ status: "success", proposal });
}
