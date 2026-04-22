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
        // Owners always qualify — including for admin-gated actions.
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
    // IDOR hardening: require caller to belong to at least one workspace
    // under the org. Connection rows include summary/diagram/architecture/
    // openApiSpec which would otherwise leak across tenants.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const connections = await db.connection.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        diagram: true,
        architecture: true,
        openApiSpec: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(connections);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/connections] Error:", error);
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const { connectionId } = await request.json();
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    // IDOR hardening: deletion is gated on ADMIN/OWNER of at least one
    // workspace under the org. Plain members can read but not delete.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    // Ensure the connection belongs to this org
    const connection = await db.connection.findFirst({
      where: { id: connectionId, orgId },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await db.connection.delete({ where: { id: connectionId } });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/connections] Error:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
