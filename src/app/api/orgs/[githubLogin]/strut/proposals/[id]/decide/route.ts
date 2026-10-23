/**
 * POST /api/orgs/[githubLogin]/strut/proposals/[id]/decide
 *   { runId, action: "accept" | "reject", reason?, input? }
 *
 * A person's decision on a strut proposal card, forwarded to
 * `POST {lab}/proposals/:id/decide` on the proposing turn's swarm as the
 * CLICKING user (`x-strut-actor`), then written into the conversation as a
 * result row ("Applied: <title>" / "Rejected: <title>" / the error). The
 * same access rule as the read (`services/strut-proposals.ts`).
 *
 *   200 `{ proposal }`         — the record after the decision (the step
 *                                already run on accept)
 *   409 `{ error, proposal }`  — already decided; the record as it stands
 *   400 `{ error }`            — strut refused the edits, or the step is gone
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { notifyInitiativeUpdated } from "@/lib/pusher";
import {
  StrutProposalError,
  appendProposalResultRow,
  decideStrutProposal,
  resolveProposalTurn,
} from "@/services/strut-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** An accept runs the step on strut before it answers. */
export const maxDuration = 120;

const bodySchema = z.object({
  runId: z.string().trim().min(1).max(200),
  action: z.enum(["accept", "reject"]),
  reason: z.string().max(2_000).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string; id: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin, id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !id || id.length > 200) {
    return NextResponse.json(
      { error: 'Expected { runId, action: "accept" | "reject", reason?, input? }' },
      { status: 400 },
    );
  }
  const { runId, action, reason, input } = parsed.data;

  try {
    const row = await resolveProposalTurn({ githubLogin, userId, runId });
    const outcome = await decideStrutProposal(
      row,
      id,
      { action, ...(reason?.trim() ? { reason: reason.trim() } : {}), ...(input ? { input } : {}) },
      userId,
    );
    if (outcome.status === 200) {
      await appendProposalResultRow(row, outcome.proposal);
      // An accepted step wrote the graph: open canvases on that workspace read its plans again.
      if (action === "accept" && outcome.proposal.workspaceSlug)
        notifyInitiativeUpdated(githubLogin, { workspaceSlug: outcome.proposal.workspaceSlug });
      return NextResponse.json({ proposal: outcome.proposal });
    }
    if (outcome.status === 409)
      return NextResponse.json({ error: outcome.error, proposal: outcome.proposal }, { status: 409 });
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  } catch (err) {
    if (err instanceof StrutProposalError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
