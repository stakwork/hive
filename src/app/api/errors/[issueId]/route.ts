import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getErrorIssueDetail, updateErrorIssueStatus, InvalidStatusError } from "@/services/error-issues";

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

/**
 * GET /api/errors/[issueId]
 *
 * Returns the issue detail plus its recent ErrorEvents (paginated).
 * workspaceId is derived from the DB record — never trusted from a query param.
 *
 * Query params:
 *   events_limit?: number — max events to return (default: 20)
 *   events_skip?:  number — events offset (default: 0)
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { issueId } = await params;

    const { searchParams } = new URL(request.url);
    const eventsLimit = Math.min(parseInt(searchParams.get("events_limit") ?? "20", 10), 100);
    const eventsSkip = parseInt(searchParams.get("events_skip") ?? "0", 10);

    const detail = await getErrorIssueDetail(issueId, eventsLimit, eventsSkip);

    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // IDOR guard: derive workspaceId from the DB, not from the request
    const access = await validateWorkspaceAccessById(detail.issue.workspaceId, userOrResponse.id);
    if (!access.hasAccess || !access.canRead) {
      // Return 404 to avoid leaking existence of issues in other workspaces
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(detail, { status: 200 });
  } catch (error) {
    console.error("[errors] GET /api/errors/[issueId] failed", error);
    return NextResponse.json({ error: "Failed to fetch error issue" }, { status: 500 });
  }
}

/**
 * PATCH /api/errors/[issueId]
 *
 * Updates the triage status of an ErrorIssue.
 * Body: { status: "UNRESOLVED" | "RESOLVED" | "IGNORED" }
 *
 * workspaceId is derived from the DB record — never trusted from the body.
 * Requires canWrite on the issue's real workspace.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { issueId } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const statusParam = body.status;
    if (typeof statusParam !== "string") {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    // Resolve real workspaceId from DB before any mutation
    const { db } = await import("@/lib/db");
    const issue = await db.errorIssue.findUnique({
      where: { id: issueId },
      select: { workspaceId: true },
    });

    if (!issue) {
      // 404 to avoid leaking existence
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const access = await validateWorkspaceAccessById(issue.workspaceId, userOrResponse.id);
    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const result = await updateErrorIssueStatus(issueId, statusParam);
      return NextResponse.json({ data: result.issue }, { status: 200 });
    } catch (err) {
      if (err instanceof InvalidStatusError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    console.error("[errors] PATCH /api/errors/[issueId] failed", error);
    return NextResponse.json({ error: "Failed to update error issue" }, { status: 500 });
  }
}
