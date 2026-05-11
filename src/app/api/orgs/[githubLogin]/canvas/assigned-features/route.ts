import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  assignFeatureOnCanvas,
  notifyFeatureAssignmentRefresh,
  readAssignedFeatures,
  ROOT_REF,
  unassignFeatureOnCanvas,
} from "@/lib/canvas";

/**
 * Dedicated endpoint for the `CanvasBlob.assignedFeatures` overlay —
 * the list of feature ids pinned onto a canvas. Mirrors the
 * `/canvas/hide` route's shape: dedicated POST so a routine autosave
 * PUT never resets the list, plus a GET for the assign-existing UI to
 * read the current list and mark already-pinned features.
 *
 * Today the only canvas type that honors `assignedFeatures` is the
 * workspace sub-canvas (`ref` starts with `ws:`). Writes on other
 * refs are accepted but won't render until a future projector reads
 * the field there.
 *
 *   GET  ?ref=<ws:cuid>                        → { featureIds: [...] }
 *   POST { ref, featureId, action: "assign" | "unassign" } → { ok: true }
 *
 * Org-membership guard is identical to the other org canvas routes.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const ref = request.nextUrl.searchParams.get("ref") ?? ROOT_REF;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    const featureIds = await readAssignedFeatures(org.id, ref);
    return NextResponse.json({ featureIds });
  } catch (error) {
    console.error(
      "[GET /api/orgs/[githubLogin]/canvas/assigned-features] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to read assigned features" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const ref = typeof body?.ref === "string" ? body.ref : ROOT_REF;
    const featureId = typeof body?.featureId === "string" ? body.featureId : null;
    const action = body?.action;

    if (!featureId) {
      return NextResponse.json(
        { error: "Body must include `featureId`" },
        { status: 400 },
      );
    }
    if (action !== "assign" && action !== "unassign") {
      return NextResponse.json(
        { error: 'action must be "assign" or "unassign"' },
        { status: 400 },
      );
    }
    // Today the overlay is only meaningful on a workspace sub-canvas.
    // Reject other refs explicitly so a misdirected agent call doesn't
    // silently write into a blob whose projector ignores the field.
    if (!ref.startsWith("ws:")) {
      return NextResponse.json(
        {
          error:
            "Assigned-features overlay is only honored on workspace canvases (ref starting with `ws:`).",
        },
        { status: 400 },
      );
    }

    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Validate the feature belongs to the workspace identified by the
    // ref AND to this org. Without this check, a guessed cuid could
    // pin another org's feature; pinning surfaces title/status in the
    // workspace canvas, so this is a real read-leak surface.
    const workspaceId = ref.slice("ws:".length);
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        workspaceId: true,
        workspace: { select: { sourceControlOrgId: true } },
      },
    });
    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }
    if (feature.workspace.sourceControlOrgId !== org.id) {
      return NextResponse.json(
        { error: "Feature does not belong to this organization" },
        { status: 403 },
      );
    }
    if (feature.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Feature does not belong to the workspace identified by ref" },
        { status: 400 },
      );
    }

    if (action === "assign") {
      await assignFeatureOnCanvas(org.id, ref, featureId);
    } else {
      await unassignFeatureOnCanvas(org.id, ref, featureId);
    }
    void notifyFeatureAssignmentRefresh(
      githubLogin,
      ref,
      featureId,
      action === "assign" ? "feature-pinned" : "feature-unpinned",
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/orgs/[githubLogin]/canvas/assigned-features] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to update assigned features" },
      { status: 500 },
    );
  }
}
