import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

const EMPTY_CANVAS = { nodes: [], edges: [] } as const;

/** Sentinel for the root canvas row; see schema comment on `Canvas.ref`. */
const ROOT_REF = "";

/** Reject anything that isn't a JSON object matching the CanvasData shape. */
function validateCanvasData(value: unknown): value is Record<string, unknown> {
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

/** Fetch the root canvas for an org. Creates an empty one on first read. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  try {
    const org = await findOrgForUser(githubLogin, userOrResponse.id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const root = await db.canvas.upsert({
      where: { orgId_ref: { orgId: org.id, ref: ROOT_REF } },
      update: {},
      create: { orgId: org.id, ref: ROOT_REF, data: EMPTY_CANVAS },
    });

    return NextResponse.json({ data: root.data, updatedAt: root.updatedAt });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/canvas] Error:", error);
    return NextResponse.json({ error: "Failed to fetch canvas" }, { status: 500 });
  }
}

/** Replace the full root canvas document. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
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

    const org = await findOrgForUser(githubLogin, userOrResponse.id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const jsonData = data as Prisma.InputJsonValue;
    const saved = await db.canvas.upsert({
      where: { orgId_ref: { orgId: org.id, ref: ROOT_REF } },
      update: { data: jsonData },
      create: { orgId: org.id, ref: ROOT_REF, data: jsonData },
    });

    return NextResponse.json({ data: saved.data, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/canvas] Error:", error);
    return NextResponse.json({ error: "Failed to save canvas" }, { status: 500 });
  }
}
