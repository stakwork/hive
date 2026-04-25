import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

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

    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: org?.schematic ?? null });
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

    const org = await db.sourceControlOrg.update({
      where: { id: orgId },
      data: { schematic },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: org.schematic });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/schematic] Error:", error);
    return NextResponse.json({ error: "Failed to update schematic" }, { status: 500 });
  }
}
