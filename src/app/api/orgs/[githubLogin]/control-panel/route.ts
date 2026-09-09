/**
 * GET /api/orgs/[githubLogin]/control-panel?limit=30
 *
 * The calling user's control panel: their Jamie chats in this org (the
 * newest `limit` by activity) and the plans those chats spawned. Powers
 * the control panel column on the org page (`?view=control-panel`).
 *
 * Session required (middleware "protected" default); membership is
 * re-checked through `resolveAuthorizedOrgId` so a private org's login
 * can't be probed for workspace names.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getControlPanelItems } from "@/services/orgs/control-panel";
import type { ControlPanelResponse } from "@/types/control-panel";

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // The service owns the default and the cap.
    const parsed = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(parsed) ? parsed : undefined;

    const body: ControlPanelResponse = await getControlPanelItems({ githubLogin, orgId, userId, limit });
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/control-panel] Error:", error);
    return NextResponse.json({ error: "Failed to load control panel" }, { status: 500 });
  }
}
