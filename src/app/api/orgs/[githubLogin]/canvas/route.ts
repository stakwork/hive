import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import { readCanvas, writeCanvas, ROOT_REF } from "@/lib/canvas";

/** Reject anything that isn't a JSON object matching the CanvasData shape. */
function validateCanvasData(value: unknown): value is {
  nodes?: unknown[];
  edges?: unknown[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.nodes != null && !Array.isArray(v.nodes)) return false;
  if (v.edges != null && !Array.isArray(v.edges)) return false;
  return true;
}

/**
 * Resolve the org by githubLogin while simultaneously verifying the caller
 * has at least one workspace in it.  Returns null when the org does not exist
 * OR the user has no workspace there (both cases → 404 to avoid leaking
 * whether the org exists at all).
 */
async function findOrgForUser(githubLogin: string, userId: string) {
  return db.sourceControlOrg.findFirst({
    where: {
      githubLogin,
      workspaces: {
        some: {
          deleted: false,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, leftAt: null } } },
          ],
        },
      },
    },
    select: { id: true },
  });
}

/**
 * Fetch the root canvas for an org. Returns the merged `CanvasData` —
 * authored content plus projected live nodes (workspaces, etc.). The
 * caller sees one uniform `{ nodes, edges }` document; it never has to
 * distinguish projected from authored content.
 */
export async function GET(
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
    const org = await findOrgForUser(githubLogin, userOrResponse.id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const data = await readCanvas(org.id, ROOT_REF);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/canvas] Error:", error);
    return NextResponse.json({ error: "Failed to fetch canvas" }, { status: 500 });
  }
}

/**
 * Replace the root canvas. The client always sends the full merged
 * document back; the server splits out just the authored half + any
 * position overlays for live ids before persisting.
 */
export async function PUT(
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
    const data = body?.data;
    if (!validateCanvasData(data)) {
      return NextResponse.json({ error: "Invalid canvas data" }, { status: 400 });
    }

    const org = await findOrgForUser(githubLogin, userOrResponse.id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    await writeCanvas(org.id, ROOT_REF, {
      nodes: (data.nodes ?? []) as never,
      edges: (data.edges ?? []) as never,
    });
    // Return the fresh merged view so clients stay in sync without a
    // second round-trip. Cheap (one extra read) and avoids subtle
    // divergence if projectors computed new rollups mid-request.
    const merged = await readCanvas(org.id, ROOT_REF);
    return NextResponse.json({ data: merged });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/canvas] Error:", error);
    return NextResponse.json({ error: "Failed to save canvas" }, { status: 500 });
  }
}
