import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

/**
 * List feature candidates that can be assigned to this initiative from
 * the canvas's **+ Feature → Assign existing** tab.
 *
 * The candidate pool is **loose features only** — features whose
 * `initiativeId IS NULL` AND `milestoneId IS NULL`. Restricting to
 * loose features sidesteps the milestone-invariant problem entirely:
 * moving a feature from initiative A to initiative B without also
 * clearing its `milestoneId` would violate
 * `milestone.initiativeId === Feature.initiativeId` and be rejected
 * by `updateFeature`. Loose features have nothing to clear, so the
 * one-PATCH assign path is always legal.
 *
 * **Filters**:
 *   - `workspaceId` (optional) — narrow to a single workspace under
 *     this org. Cross-org workspaceIds return an empty array (silent
 *     IDOR prevention, mirrors the milestones/features/search route).
 *   - `query` (optional) — case-insensitive title contains; requires
 *     ≥ 3 chars (same gate as the milestones search route).
 *
 * Hard cap of 50 results — the dialog only needs enough to make a
 * choice, not the long tail. Sorted by `updatedAt desc`.
 *
 * Sibling pattern to
 * `/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/features/search`,
 * which serves the same "what can I attach here" lookup but for a
 * milestone instead of an initiative.
 */
const LIMIT = 50;

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ githubLogin: string; initiativeId: string }>;
  },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId } = await params;
  const userId = userOrResponse.id;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  const query = searchParams.get("query") ?? undefined;

  if (query !== undefined && query.length > 0 && query.length < 3) {
    return NextResponse.json([]);
  }

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Confirm the initiative belongs to this org before returning any
    // data — prevents enumeration via fabricated path params.
    const initiative = await db.initiative.findFirst({
      where: { id: initiativeId, orgId },
      select: { id: true },
    });
    if (!initiative) {
      return NextResponse.json(
        { error: "Initiative not found" },
        { status: 404 },
      );
    }

    // Resolve the workspace pool to limit candidates to this org. If a
    // workspaceId filter was supplied, confirm it belongs to this org
    // before using it (mirror of the IDOR check in the milestone
    // features/search route).
    const orgWorkspaces = await db.workspace.findMany({
      where: { deleted: false, sourceControlOrgId: orgId },
      select: { id: true, name: true },
    });
    const orgWorkspaceIds = orgWorkspaces.map((w) => w.id);
    if (orgWorkspaceIds.length === 0) {
      return NextResponse.json([]);
    }
    if (workspaceId && !orgWorkspaceIds.includes(workspaceId)) {
      return NextResponse.json([]);
    }

    const features = await db.feature.findMany({
      where: {
        deleted: false,
        // Loose features only — `initiativeId IS NULL` AND
        // `milestoneId IS NULL`. The `milestoneId IS NULL` predicate
        // is technically redundant (milestone always implies its
        // initiative via the coherence rule), but defensive against
        // direct-DB writes that bypass `updateFeature`.
        initiativeId: null,
        milestoneId: null,
        workspaceId: workspaceId
          ? workspaceId
          : { in: orgWorkspaceIds },
        ...(query && query.length >= 3
          ? { title: { contains: query, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    });

    return NextResponse.json(features);
  } catch (error) {
    console.error(
      "[GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/features] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to list assignable features" },
      { status: 500 },
    );
  }
}
