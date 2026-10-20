/**
 * GET /api/orgs/[githubLogin]/strut/proposals/[id]?run=<StrutRun.id>
 *
 * The record behind a strut proposal card (`StrutProposalCard`; strut
 * `specs/API.md` §12), read from the swarm that ran the proposing
 * orchestrator turn — the `StrutRun` row `run` names. The caller must
 * belong to the org and the turn's conversation must be theirs or shared
 * (`services/strut-proposals.ts`); every miss is a 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { StrutProposalError, readStrutProposal, resolveProposalTurn } from "@/services/strut-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string; id: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, id } = await params;
  const runId = request.nextUrl.searchParams.get("run") ?? "";
  if (!runId || !id || id.length > 200)
    return NextResponse.json({ error: "run and a proposal id are required" }, { status: 400 });

  try {
    const row = await resolveProposalTurn({ githubLogin, userId, runId });
    const proposal = await readStrutProposal(row, id);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ proposal }, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof StrutProposalError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
