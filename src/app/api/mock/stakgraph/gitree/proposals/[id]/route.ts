import { NextRequest, NextResponse } from "next/server";
import { mockProposals } from "../fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Proposal Detail Endpoint
 *
 * GET — Returns a single proposal by id, or 404 { error } if not found.
 */
export async function GET(
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

  return NextResponse.json({ proposal });
}
