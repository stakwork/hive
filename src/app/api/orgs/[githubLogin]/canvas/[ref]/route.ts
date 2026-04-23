import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
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

async function findOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
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

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await findOrg(githubLogin);
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

    const org = await findOrg(githubLogin);
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
