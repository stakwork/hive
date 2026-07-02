import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getErrorEventMeta, fetchRedactedBlobContent } from "@/services/error-issues";

interface RouteContext {
  params: Promise<{ issueId: string; eventId: string }>;
}

/**
 * GET /api/errors/[issueId]/events/[eventId]/blob
 *
 * Returns the raw (redacted) blob payload for a single ErrorEvent.
 *
 * Security order:
 * 1. Authenticate caller.
 * 2. Resolve event ownership from DB (assert event.issueId === issueId).
 * 3. Authorize caller against the event's real workspaceId.
 * 4. Only then fetch the external blob — no external call before auth.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { issueId, eventId } = await params;

    // Step 2: resolve ownership — asserts event.issueId === issueId
    const meta = await getErrorEventMeta(issueId, eventId);
    if (!meta) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Step 3: authorize BEFORE any external call
    const access = await validateWorkspaceAccessById(meta.workspaceId, userOrResponse.id);
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Step 4: fetch blob only after auth is confirmed
    let content: string;
    try {
      content = await fetchRedactedBlobContent(meta.blobUrl);
    } catch (err) {
      console.error("[errors] blob fetch failed", { issueId, eventId, err });
      return NextResponse.json(
        { error: "Blob content unavailable" },
        { status: 502, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[errors] GET /api/errors/[issueId]/events/[eventId]/blob failed", error);
    return NextResponse.json(
      { error: "Failed to fetch blob" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
