import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

/**
 * Returns the `SourceControlOrg.id` for the given `githubLogin` iff the user
 * has membership in at least one workspace under that org. When
 * `requireAdmin` is true, the user must own or be an ADMIN of at least one
 * such workspace.
 *
 * Returns null if the org doesn't exist or the user has no qualifying
 * workspace — callers should translate this into a unified 404 so we
 * don't leak org existence.
 *
 * Mirrors the helper used in `orgs/[githubLogin]/connections/route.ts`.
 */
async function resolveAuthorizedOrgId(
  githubLogin: string,
  userId: string,
  requireAdmin: boolean,
): Promise<string | null> {
  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) return null;

  const adminRoles: WorkspaceRole[] = [WorkspaceRole.ADMIN];

  const workspace = await db.workspace.findFirst({
    where: {
      deleted: false,
      sourceControlOrgId: org.id,
      OR: [
        { ownerId: userId },
        {
          members: {
            some: {
              userId,
              leftAt: null,
              ...(requireAdmin ? { role: { in: adminRoles } } : {}),
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (!workspace) return null;
  return org.id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    // IDOR hardening: require the caller to belong to at least one
    // workspace under this org before reading the schematic.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const row = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: row?.schematic ?? null });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/schematic] Error:", error);
    return NextResponse.json({ error: "Failed to fetch schematic" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  let schematic: string;
  try {
    const body = await request.json();
    if (typeof body.schematic !== "string") {
      return NextResponse.json({ error: "schematic must be a string" }, { status: 400 });
    }
    schematic = body.schematic;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // IDOR hardening: writes require OWNER or ADMIN membership on at
    // least one workspace under the org. Plain members can read but
    // not overwrite the schematic.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const updated = await db.sourceControlOrg.update({
      where: { id: orgId },
      data: { schematic },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: updated.schematic });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/schematic] Error:", error);
    return NextResponse.json({ error: "Failed to update schematic" }, { status: 500 });
  }
}
