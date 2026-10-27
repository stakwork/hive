import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getBaseUrl } from "@/lib/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { dispatchErrorFix, refreshErrorFix } from "@/services/error-fix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ issueId: string }>;
}

/** workspaceId is derived from the DB record — never trusted from the request. */
async function authorize(request: NextRequest, issueId: string, needWrite: boolean) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return { response: userOrResponse };

  const issue = await db.errorIssue.findUnique({ where: { id: issueId }, select: { workspaceId: true } });
  if (!issue) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const access = await validateWorkspaceAccessById(issue.workspaceId, userOrResponse.id);
  if (!access.hasAccess || !(needWrite ? access.canWrite : access.canRead)) {
    // 404 to avoid leaking existence of issues in other workspaces
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { user: userOrResponse };
}

/** GET /api/errors/[issueId]/fix — current fix state (refreshed from the job's records). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { issueId } = await params;
    const auth = await authorize(request, issueId, false);
    if (auth.response) return auth.response;

    const fix = await refreshErrorFix(issueId);
    if (!fix) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: fix }, { status: 200 });
  } catch (error) {
    console.error("[errors] GET /api/errors/[issueId]/fix failed", error);
    return NextResponse.json({ error: "Failed to fetch fix status" }, { status: 500 });
  }
}

/**
 * POST /api/errors/[issueId]/fix
 *
 * Dispatches a strut job that investigates the error and opens a PR on the
 * issue's repository. 202 with the fix state when dispatched; 409 with the
 * existing fix state when a non-failed dispatch already exists (retry is
 * allowed only after a failed one). Requires canWrite on the issue's workspace.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { issueId } = await params;
    const auth = await authorize(request, issueId, true);
    if (auth.response) return auth.response;

    const result = await dispatchErrorFix({
      issueId,
      userId: auth.user!.id,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    });

    switch (result.status) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "exists":
        return NextResponse.json({ error: "A fix has already been dispatched for this error", data: result.fix }, { status: 409 });
      case "error":
        return NextResponse.json({ error: result.error }, { status: result.code === "NO_REPOSITORY" ? 422 : 502 });
      default:
        return NextResponse.json({ data: result.fix }, { status: 202 });
    }
  } catch (error) {
    console.error("[errors] POST /api/errors/[issueId]/fix failed", error);
    return NextResponse.json({ error: "Failed to dispatch fix" }, { status: 500 });
  }
}
