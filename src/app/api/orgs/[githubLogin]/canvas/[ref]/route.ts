import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

const EMPTY_CANVAS = { nodes: [], edges: [] } as const;

/** Refs are user-chosen opaque strings; we just refuse the root sentinel. */
function validateRef(ref: string): ref is string {
  return typeof ref === "string" && ref.length > 0 && ref.length <= 512;
}

function validateCanvasData(value: unknown): value is Record<string, unknown> {
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

/** Fetch (or lazily create) a sub-canvas addressed by `ref`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; ref: string }> }
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
    const org = await findOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Upsert on GET so first-time drill-down always resolves, even before the
    // user has edited the sub-canvas. Callers can tell "empty but exists"
    // from "never created" by inspecting `data.nodes`.
    const canvas = await db.canvas.upsert({
      where: { orgId_ref: { orgId: org.id, ref } },
      update: {},
      create: { orgId: org.id, ref, data: EMPTY_CANVAS },
    });

    return NextResponse.json({ data: canvas.data, updatedAt: canvas.updatedAt });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/canvas/[ref]] Error:", error);
    return NextResponse.json({ error: "Failed to fetch canvas" }, { status: 500 });
  }
}

/** Replace a sub-canvas document. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; ref: string }> }
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

    const org = await findOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const jsonData = data as Prisma.InputJsonValue;
    const saved = await db.canvas.upsert({
      where: { orgId_ref: { orgId: org.id, ref } },
      update: { data: jsonData },
      create: { orgId: org.id, ref, data: jsonData },
    });

    return NextResponse.json({ data: saved.data, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/canvas/[ref]] Error:", error);
    return NextResponse.json({ error: "Failed to save canvas" }, { status: 500 });
  }
}
