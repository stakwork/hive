/**
 * GET /api/orgs/[githubLogin]/attention?limit=3
 *
 * Returns the top items needing the current user's attention across
 * every workspace they can see in this org. Powers the synthetic
 * intro message in the canvas chat (see
 * `src/app/org/[githubLogin]/_components/OrgCanvasView.tsx`).
 *
 * The endpoint falls through to the middleware "protected" default,
 * so the session is required. We additionally check that the user
 * actually belongs to the org via `resolveAuthorizedOrgId` — without
 * it, an attacker who knows a private org's `githubLogin` could
 * enumerate workspace names through the response.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getTopAttentionItems } from "@/services/attention/topItems";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    // `false` = read-only access is fine; we don't need write rights
    // to summarize work. Same pattern as the initiatives GET handler.
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const parsed = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const result = await getTopAttentionItems({ githubLogin, userId, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/attention] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch attention items" },
      { status: 500 },
    );
  }
}
