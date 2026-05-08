import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { notifyResearchReassignmentRefresh } from "@/lib/canvas";

/**
 * REST surface for an individual `Research` row, addressed by its DB id.
 *
 * Single mutating handler today: PATCH `initiativeId`, used by the
 * canvas drag-and-drop "research → initiative" pairing in
 * `OrgCanvasBackground.handleNodeDrop`. Mirrors the feature →
 * milestone reassignment posture (`/api/features/[featureId]` PATCH):
 *
 *   - Snapshot `(initiativeId)` BEFORE the auth check so we can fan
 *     out CANVAS_UPDATED on both the canvas the row left AND the one
 *     it landed on.
 *   - Member-gated, scoped to the resolved `orgId` (no admin
 *     requirement — the same posture as `Feature.PATCH`).
 *   - Validate the target `initiativeId` belongs to the same org so
 *     the model can't be hijacked into cross-org references.
 *   - Fan-out via the shared `notifyResearchReassignmentRefresh`
 *     helper which handles the root + initiative ref de-dupe.
 *
 * No POST/DELETE here — creation flows exclusively through the
 * `save_research` agent tool, and deletion lives on the parent
 * collection route. Keep this file scoped to mutations on an
 * existing row.
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ githubLogin: string; researchId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, researchId } = await params;
  const userId = userOrResponse.id;

  try {
    const body = await request.json();

    // Validate the body shape up-front. Today we only accept
    // `initiativeId` (string | null) — the only reassignment the
    // canvas surfaces. Title / topic / summary are agent-owned via
    // `update_research` and shouldn't be editable from the canvas
    // gesture path. Other fields are silently ignored rather than
    // 400ing so we can extend without breaking existing clients.
    if (!("initiativeId" in body)) {
      return NextResponse.json(
        { error: "No supported fields in body" },
        { status: 400 },
      );
    }
    const initiativeIdInput: unknown = body.initiativeId;
    if (
      initiativeIdInput !== null &&
      typeof initiativeIdInput !== "string"
    ) {
      return NextResponse.json(
        { error: "initiativeId must be a string or null" },
        { status: 400 },
      );
    }

    // Member-gated: caller must belong to at least one workspace
    // under this org. Same posture as the parent collection's GET.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    // Snapshot before the write — same pattern as the feature PATCH
    // route. We need both the pre-change `initiativeId` (to fan out
    // on the source canvas) and to confirm the row belongs to the
    // org we just authorized against.
    const existing = await db.research.findFirst({
      where: { id: researchId, orgId },
      select: { id: true, slug: true, initiativeId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Research not found" },
        { status: 404 },
      );
    }

    // Validate the target initiative belongs to the same org. Don't
    // trust the client with cross-org references. Unlike
    // `save_research` (which silently downgrades a bad id to root),
    // the PATCH path explicitly rejects — the user dropped onto a
    // specific card and got an error response is more useful than a
    // silent "ended up at root" surprise.
    if (initiativeIdInput !== null) {
      const init = await db.initiative.findFirst({
        where: { id: initiativeIdInput, orgId },
        select: { id: true },
      });
      if (!init) {
        return NextResponse.json(
          { error: "Initiative not found in this org" },
          { status: 404 },
        );
      }
    }

    const nextInitiativeId: string | null = initiativeIdInput;

    // Short-circuit when no actual change. Skips the fan-out cost on
    // a no-op drop (user dropped a research onto the same initiative
    // it was already on).
    if (existing.initiativeId === nextInitiativeId) {
      return NextResponse.json({ status: "unchanged" });
    }

    await db.research.update({
      where: { id: existing.id },
      data: { initiativeId: nextInitiativeId },
    });

    // Fan out CANVAS_UPDATED on both the source and target refs so
    // the row jumps canvases live. Fire-and-forget — Pusher hiccups
    // must not fail the PATCH that triggered them.
    void notifyResearchReassignmentRefresh(
      githubLogin,
      existing.id,
      existing.slug,
      { initiativeId: existing.initiativeId },
      { initiativeId: nextInitiativeId },
    );

    return NextResponse.json({
      status: "updated",
      slug: existing.slug,
      initiativeId: nextInitiativeId,
    });
  } catch (error) {
    console.error(
      "[PATCH /api/orgs/[githubLogin]/research/[researchId]] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to update research" },
      { status: 500 },
    );
  }
}
