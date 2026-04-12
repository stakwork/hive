import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const connections = await db.connection.findMany({
      where: { orgId: org.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
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

  try {
    const { connectionId } = await request.json();
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Ensure the connection belongs to this org
    const connection = await db.connection.findFirst({
      where: { id: connectionId, orgId: org.id },
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
