import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { revokeOrgApiKey } from "@/lib/org-api-keys";

/**
 * DELETE /api/orgs/[githubLogin]/api-keys/[keyId]
 * Revoke an org API key (admin only). The row is kept for audit.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; keyId: string }> },
) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, keyId } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const revoked = await revokeOrgApiKey({ orgId, keyId, revokedById: userOrResponse.id });
    if (!revoked) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/api-keys/[keyId]]", error);
    return NextResponse.json({ error: "Failed to revoke API key" }, { status: 500 });
  }
}
