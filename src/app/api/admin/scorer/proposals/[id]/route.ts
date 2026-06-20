import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  applyProposal,
  rejectProposal,
  editProposal,
} from "@/lib/scorer/improve";

/**
 * PATCH — accept, reject, or edit a description proposal.
 * Body: { action: "accept" | "reject" | "edit", text?: string }
 *
 * Accept applies the recorded edits to the live Workspace.description via
 * exact str_replace; if the value drifted, the proposal is marked CONFLICT.
 * Edit replaces the proposed final text (recomputes the diff).
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

    if (action === "edit") {
      const text = body?.text;
      if (typeof text !== "string") {
        return NextResponse.json(
          { error: "text is required for edit" },
          { status: 400 }
        );
      }
      const result = await editProposal(id, text);
      const status = result.error ? 400 : 200;
      return NextResponse.json({ id, ...result }, { status });
    }

    if (action === "accept") {
      const result = await applyProposal(id);
      const status =
        result.status === "CONFLICT" ? 409 : result.error ? 400 : 200;
      return NextResponse.json({ id, ...result }, { status });
    }

    return NextResponse.json(
      { error: "action must be 'accept', 'reject', or 'edit'" },
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
