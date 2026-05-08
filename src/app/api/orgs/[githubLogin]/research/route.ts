import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import {
  notifyCanvasUpdated,
  notifyResearchEventByLogin,
} from "@/lib/canvas";

/**
 * REST surface for Research documents.
 *
 * Mirrors `/api/orgs/[githubLogin]/connections/route.ts`:
 *   - GET: list (member-gated). Returns the rows the canvas projector
 *     uses, plus `content` so a list view (if we ever add one) doesn't
 *     need a per-row hydrate.
 *   - DELETE: by `researchId` (admin-gated). Cascades nothing \u2014 the
 *     row owns no children. Fans out CANVAS_UPDATED on the affected
 *     scope so open canvases drop the node.
 *
 * No POST: creation is exclusively through the `save_research` agent
 * tool (`src/lib/ai/researchTools.ts`). Putting a public POST here
 * would let a client create a row that the chat doesn't know about,
 * breaking the "chat is the source of truth for research lifecycle"
 * invariant. Same posture as Connections.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    // IDOR hardening: caller must belong to at least one workspace
    // under this org. Research rows include `content` (potentially
    // sensitive markdown the agent wrote about external services); we
    // don't want them leaking across tenants.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const researches = await db.research.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        topic: true,
        title: true,
        summary: true,
        content: true,
        initiativeId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(researches);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/research] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch research" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const { researchId } = await request.json();
    if (!researchId || typeof researchId !== "string") {
      return NextResponse.json(
        { error: "researchId is required" },
        { status: 400 },
      );
    }

    // Admin-gated, mirroring the Connection delete path. Members can
    // read research but only ADMIN/OWNER of at least one workspace
    // under the org can delete.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    // Fetch first so we know the (initiativeId, ref) to fan out on,
    // and to enforce the org-membership guard before deleting.
    const research = await db.research.findFirst({
      where: { id: researchId, orgId },
      select: { id: true, slug: true, initiativeId: true },
    });
    if (!research) {
      return NextResponse.json(
        { error: "Research not found" },
        { status: 404 },
      );
    }

    await db.research.delete({ where: { id: research.id } });

    // Fan out so any open canvas drops the node and any open viewer
    // can show a "deleted" state. The CANVAS_UPDATED ref tracks the
    // canvas the row was projected onto (root if initiativeId is
    // null; the initiative sub-canvas otherwise).
    const ref = research.initiativeId
      ? `initiative:${research.initiativeId}`
      : "";
    await notifyCanvasUpdated(orgId, ref, "research-deleted", {
      slug: research.slug,
      researchId: research.id,
    });
    await notifyResearchEventByLogin(githubLogin, research.slug, "deleted");

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/research] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete research" },
      { status: 500 },
    );
  }
}
