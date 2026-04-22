import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { readCanvas, writeCanvas, ROOT_REF } from "@/lib/canvas";
import { getUserOrgAccess } from "@/services/workspace";

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

  try {
    const org = await getUserOrgAccess(userOrResponse.id, githubLogin);
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

  try {
    const body = await request.json();
    const data = body?.data;
    if (!validateCanvasData(data)) {
      return NextResponse.json({ error: "Invalid canvas data" }, { status: 400 });
    }

    const org = await getUserOrgAccess(userOrResponse.id, githubLogin);
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
