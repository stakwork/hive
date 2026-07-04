import { NextRequest, NextResponse } from "next/server";
import { ErrorIssueStatus } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { listErrorIssues, type ErrorIssuesSortOrder } from "@/services/error-issues";

/**
 * GET /api/errors
 *
 * Lists ErrorIssues for a workspace with optional filtering and pagination.
 *
 * Query params:
 *   workspace_id: string  — required; IDOR guard: user must be a member.
 *   status?:      string  — optional; filter by ErrorIssueStatus enum value,
 *                           or "all" (case-insensitive) to include every status.
 *                           When absent, defaults to active-only (excludes RESOLVED/IGNORED).
 *   repoKey?:     string  — optional; filter by repo key.
 *   skip?:        number  — pagination offset (default: 0).
 *   limit?:       number  — pagination limit (default: 20, max: 100).
 */
export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspace_id");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
    }

    const access = await validateWorkspaceAccessById(workspaceId, userOrResponse.id);
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    // Optional filters
    const statusParam = searchParams.get("status");
    const repoKey = searchParams.get("repoKey") ?? undefined;

    const validStatuses: ErrorIssueStatus[] = ["UNRESOLVED", "RESOLVED", "IGNORED"];
    const isAll = statusParam?.toLowerCase() === "all";

    if (statusParam && !isAll && !validStatuses.includes(statusParam as ErrorIssueStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    // "all" → includeAll: true (no status constraint)
    // concrete enum value → exact match
    // absent → service applies active-only default (notIn RESOLVED/IGNORED)
    const status = !statusParam || isAll ? undefined : (statusParam as ErrorIssueStatus);
    const includeAll = isAll ? true : undefined;

    // Sort order
    const sortParam = searchParams.get("sort");
    const validSorts: ErrorIssuesSortOrder[] = ["recent", "impact"];
    if (sortParam !== null && !validSorts.includes(sortParam as ErrorIssuesSortOrder)) {
      return NextResponse.json(
        { error: `Invalid sort. Must be one of: ${validSorts.join(", ")}` },
        { status: 400 },
      );
    }
    const sort = (sortParam as ErrorIssuesSortOrder | null) ?? "recent";

    // Pagination
    const limitParam = searchParams.get("limit");
    const skipParam = searchParams.get("skip");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;
    const skip = skipParam ? parseInt(skipParam, 10) : 0;

    if (isNaN(limit) || limit < 1) {
      return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
    }
    if (isNaN(skip) || skip < 0) {
      return NextResponse.json({ error: "skip must be a non-negative number" }, { status: 400 });
    }

    const result = await listErrorIssues({ workspaceId, status, includeAll, repoKey, skip, limit, sort });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[errors] GET /api/errors failed", error);
    return NextResponse.json({ error: "Failed to fetch error issues" }, { status: 500 });
  }
}
