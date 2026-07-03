import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getRelatedErrorIssues } from "@/services/error-issues";
import { db } from "@/lib/db";

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

/**
 * GET /api/errors/[issueId]/related
 *
 * Returns other ErrorIssues in the same workspace/repository that share
 * File/Function code entities with the given issue via the knowledge graph.
 *
 * Best-effort: always returns { related: [] } on internal errors (never 500).
 * IDOR-safe: workspaceId is derived from the DB record, not the request.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { issueId } = await params;

    // Resolve issue from DB to get real workspaceId — never trust client input
    const issue = await db.errorIssue.findUnique({
      where: { id: issueId },
      select: { workspaceId: true },
    });

    if (!issue) {
      // 404 to avoid leaking existence of issues in other workspaces
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // IDOR guard: verify the requesting user has access to this workspace
    const access = await validateWorkspaceAccessById(issue.workspaceId, userOrResponse.id);
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const related = await getRelatedErrorIssues(issueId);
    return NextResponse.json({ related }, { status: 200 });
  } catch (error) {
    console.error("[error-related] GET /api/errors/[issueId]/related failed", error);
    // Best-effort: never surface a 500 for this non-blocking feature
    return NextResponse.json({ related: [] }, { status: 200 });
  }
}
