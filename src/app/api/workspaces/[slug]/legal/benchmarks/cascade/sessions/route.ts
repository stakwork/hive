import { NextRequest, NextResponse } from "next/server";
import {
  fetchRunSessions,
  mockIdentifier,
  resolveCascadeAccess,
} from "@/lib/legal-cascade/server";
import { buildMockCascadeSessions } from "@/lib/legal-cascade/fixtures";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cascade/sessions?runId=...
 *
 * All top-level agent sessions of a benchmark run, proxied from the stakgraph
 * sessions API (`agent_name_contains=<run identifier>`). The server derives
 * the identifier from the StakworkRun row (projectId first, cuid fallback);
 * rows pass through an explicit field allowlist.
 *
 * Returns:
 *  - 200 `{ success: true, data: { identifier, sessions } }` — `sessions` is
 *    empty (with `identifier: null`) when no agent has started yet
 *  - 404 for non-openlaw slugs and unknown/cross-workspace runIds
 *  - 502 when stakgraph is unreachable
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await resolveCascadeAccess(request, params);
    if (access instanceof NextResponse) return access;

    if (access.useMocks) {
      const identifier = mockIdentifier(access);
      return NextResponse.json({
        success: true,
        data: { identifier, sessions: buildMockCascadeSessions(identifier) },
      });
    }

    const result = await fetchRunSessions(access);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[legal/benchmarks/cascade/sessions] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch run sessions from stakgraph" },
      { status: 502 },
    );
  }
}
