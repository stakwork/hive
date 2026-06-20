import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { applyProposal, rejectProposal } from "@/lib/scorer/improve";

/**
 * PATCH — accept or reject a description proposal.
 * Body: { action: "accept" | "reject" }
 *
 * Accept applies the recorded edits to the live Workspace.description via
 * exact str_replace; if the value drifted, the proposal is marked CONFLICT.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const action = body?.action as string | undefined;

    if (action === "reject") {
      await rejectProposal(id);
      return NextResponse.json({ status: "REJECTED", id });
    }

    if (action === "accept") {
      const result = await applyProposal(id);
      const status =
        result.status === "CONFLICT" ? 409 : result.error ? 400 : 200;
      return NextResponse.json({ id, ...result }, { status });
    }

    return NextResponse.json(
      { error: "action must be 'accept' or 'reject'" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating proposal:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
