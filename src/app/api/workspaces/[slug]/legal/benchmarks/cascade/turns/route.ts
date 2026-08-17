import { NextRequest, NextResponse } from "next/server";
import {
  fetchRunSessions,
  fetchSessionTurns,
  mockIdentifier,
  resolveCascadeAccess,
  sessionBelongsToRun,
} from "@/lib/legal-cascade/server";
import { buildMockSessionTurns } from "@/lib/legal-cascade/fixtures";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cascade/turns?runId=...&sessionId=...&after=...
 *
 * The polling workhorse: one session's turn chain from `after` (exclusive).
 * First call with `after=-1` loads history; subsequent polls pass the max
 * order seen. Clients dedupe by order — overlap is harmless by design — and
 * stop polling when `status !== 'running'`.
 *
 * Returns 200 `{ success: true, data: { session_id, status, turn_count,
 * last_turn_at, turns } }`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await resolveCascadeAccess(request, params);
    if (access instanceof NextResponse) return access;

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query param is required" },
        { status: 400 },
      );
    }
    const afterRaw = url.searchParams.get("after");
    const after = afterRaw === null ? -1 : parseInt(afterRaw, 10);
    if (Number.isNaN(after) || after < -1) {
      return NextResponse.json(
        { error: "after must be an integer >= -1" },
        { status: 400 },
      );
    }

    if (access.useMocks) {
      const page = buildMockSessionTurns(mockIdentifier(access), sessionId, after);
      if (!page) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: page });
    }

    // Membership check: the session's root must be a top-level session of THIS run.
    const runSessions = await fetchRunSessions(access);
    if (!sessionBelongsToRun(sessionId, runSessions.sessions)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const page = await fetchSessionTurns(access, sessionId, after);
    if (!page) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: page });
  } catch (error) {
    console.error("[legal/benchmarks/cascade/turns] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session turns from stakgraph" },
      { status: 502 },
    );
  }
}
