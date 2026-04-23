import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { readCanvas, writeCanvas } from "@/lib/canvas";

/** Refs are user-chosen opaque strings; we refuse empty + over-long. */
function validateRef(ref: string): boolean {
  return typeof ref === "string" && ref.length > 0 && ref.length <= 512;
}

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

/** Fetch a merged sub-canvas (authored blob + live projection). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; ref: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  if (!validateRef(ref)) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
  }

  try {
    const org = await findOrgForUser(githubLogin, userOrResponse.id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const data = await readCanvas(org.id, ref);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/canvas/[ref]] Error:", error);
    return NextResponse.json({ error: "Failed to fetch canvas" }, { status: 500 });
  }
}

/** Replace a sub-canvas. Splitter strips live-node identity fields. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; ref: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  if (!validateRef(ref)) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
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

    await writeCanvas(org.id, ref, {
      nodes: (data.nodes ?? []) as never,
      edges: (data.edges ?? []) as never,
    });
    const merged = await readCanvas(org.id, ref);
    return NextResponse.json({ data: merged });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/canvas/[ref]] Error:", error);
    return NextResponse.json({ error: "Failed to save canvas" }, { status: 500 });
  }
}
