import { NextRequest, NextResponse } from "next/server";
import {
  fetchRunSessions,
  fetchSessionDetail,
  mockIdentifier,
  resolveCascadeAccess,
  sessionBelongsToRun,
} from "@/lib/legal-cascade/server";
import { buildMockSessionDetail } from "@/lib/legal-cascade/fixtures";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cascade/session?runId=...&sessionId=...
 *
 * One session's detail with its full descendant subtree (stakgraph
 * `?recursive=true` — flat list, each row carrying parent_session_id so the
 * client rebuilds the tree). The sessionId is validated against the run's own
 * session list so the proxy can't be used to read arbitrary swarm sessions.
 *
 * Returns 200 `{ success: true, data: { session, descendants } }`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await resolveCascadeAccess(request, params);
    if (access instanceof NextResponse) return access;

    const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query param is required" },
        { status: 400 },
      );
    }

    if (access.useMocks) {
      const detail = buildMockSessionDetail(mockIdentifier(access), sessionId, true);
      if (!detail) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const { descendants = [], ...session } = detail;
      return NextResponse.json({ success: true, data: { session, descendants } });
    }

    // Membership check: the session's root must be a top-level session of THIS run.
    const runSessions = await fetchRunSessions(access);
    if (!sessionBelongsToRun(sessionId, runSessions.sessions)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const detail = await fetchSessionDetail(access, sessionId);
    if (!detail) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error("[legal/benchmarks/cascade/session] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session from stakgraph" },
      { status: 502 },
    );
  }
}
