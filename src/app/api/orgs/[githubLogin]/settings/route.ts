import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  // Admin gate: OWNER or ADMIN membership required
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Body parse — own try/catch → 400
  let defaultWorkspaceId: string | null;
  try {
    const body = await request.json();
    if (body.defaultWorkspaceId !== null && typeof body.defaultWorkspaceId !== "string") {
      return NextResponse.json(
        { error: "defaultWorkspaceId must be a string or null" },
        { status: 400 },
      );
    }
    defaultWorkspaceId = body.defaultWorkspaceId ?? null;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate workspace belongs to this org (only when setting, not clearing)
  if (defaultWorkspaceId !== null) {
    const ws = await db.workspace.findFirst({
      where: { id: defaultWorkspaceId, deleted: false, sourceControlOrgId: orgId },
    });
    if (!ws) {
      return NextResponse.json({ error: "Workspace not found in this org" }, { status: 400 });
    }
  }

  // Write
  try {
    const org = await db.sourceControlOrg.update({
      where: { id: orgId },
      data: { defaultWorkspaceId },
      select: { defaultWorkspaceId: true },
    });
    return NextResponse.json({ defaultWorkspaceId: org.defaultWorkspaceId });
  } catch (error) {
    console.error("[PATCH /api/orgs/[githubLogin]/settings]", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
