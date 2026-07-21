import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Repo Agent Abort Endpoint
 *
 * Simulates: POST https://{swarm}:3355/repo/agent/abort
 *
 * Accepts `{ request_id }` and returns 200 by default.
 * To exercise the retry path in tests, set the
 * `x-mock-abort-fail-once` header to "true" on the first call
 * for a given request_id — the mock returns 500 once, then 200.
 */

// In-memory set of request_ids that should fail once.
const failOnceSet = new Set<string>();

export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    const body = await request.json();
    const requestId: string = body?.request_id ?? "unknown";

    // Test harness: set x-mock-abort-fail-once header to register a one-shot failure.
    const failOnce = request.headers.get("x-mock-abort-fail-once");
    if (failOnce === "true") {
      failOnceSet.add(requestId);
    }

    if (failOnceSet.has(requestId)) {
      failOnceSet.delete(requestId);
      console.log(`[StakgraphMock] POST /repo/agent/abort - returning 500 once for request_id: ${requestId}`);
      return NextResponse.json({ error: "Simulated transient failure" }, { status: 500 });
    }

    console.log(`[StakgraphMock] POST /repo/agent/abort - success for request_id: ${requestId}`);
    return NextResponse.json({ ok: true, request_id: requestId });
  } catch (error) {
    console.error("[StakgraphMock] POST /repo/agent/abort error:", error);
    return NextResponse.json({ error: "Failed to process abort request" }, { status: 500 });
  }
}
