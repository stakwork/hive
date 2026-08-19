import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPrResultStore } from "@/app/api/mock/stakgraph/repo/agent/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Progress Endpoint
 *
 * Simulates: GET https://{swarm}:3355/progress?request_id=...
 *
 * Returns a completed status with a sample mermaid diagram in the result by default.
 *
 * ## Security gate
 *
 * Returns 404 when `USE_MOCKS` is off OR when `NODE_ENV === "production"`.
 * The /api/mock subtree is publicly accessible at the middleware layer, so
 * this guard is required — not optional — now that these routes can
 * synthesize PR/approval state.
 *
 * ## Test harness (POST)
 *
 * POST to /api/mock/stakgraph/progress with a JSON body to control
 * what the next GET returns for a given request_id:
 *   { request_id, scenario: "aborted" | "completed_after_abort" | "running" | "completed" }
 *
 * "aborted"              → { status: "aborted" } (distinct abort status)
 * "completed_after_abort" → { status: "completed", result: { content: "real result" } }
 * "running"              → { status: "running" } (grace-window test: never terminal)
 * "completed"            → default completed
 *
 * ## create_pr result delivery
 *
 * When the request_id matches an entry in `mockPrResultStore` (written by
 * the repo/agent POST handler when `toolsConfig.create_pr === true`), the
 * terminal payload nests the LandChangeResult under `result.pr` as a sibling
 * of `final_answer`, mirroring the real swarm's behavior.
 */

// In-memory scenario registry for test harness
const scenarioMap = new Map<string, string>();

export async function POST(request: NextRequest) {
  // Security gate
  if (process.env.NODE_ENV === "production" || !config.USE_MOCKS) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { request_id, scenario } = body as {
      request_id?: string;
      scenario?: string;
    };
    if (!request_id || !scenario) {
      return NextResponse.json(
        { error: "request_id and scenario required" },
        { status: 400 },
      );
    }
    scenarioMap.set(request_id, scenario);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  // Security gate
  if (process.env.NODE_ENV === "production" || !config.USE_MOCKS) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json(
        { error: "Missing x-api-token header" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("request_id") ?? "";

    console.log(`[StakgraphMock] GET /progress?request_id=${requestId}`);

    const scenario = scenarioMap.get(requestId);
    // Consume the scenario so it's single-use (except "running" which we keep).
    if (scenario && scenario !== "running") {
      scenarioMap.delete(requestId);
    }

    if (scenario === "aborted") {
      return NextResponse.json({ status: "aborted" });
    }
    if (scenario === "completed_after_abort") {
      return NextResponse.json({
        status: "completed",
        result: {
          content: "Real result returned despite abort request",
        },
      });
    }
    if (scenario === "running") {
      return NextResponse.json({ status: "running" });
    }

    // ── create_pr result delivery ────────────────────────────────────
    // When this request_id corresponds to a create_pr run, serve the
    // LandChangeResult nested under `result.pr` as a sibling of
    // `final_answer` — mirroring the real swarm's terminal payload shape.
    const prResult = mockPrResultStore.get(requestId);
    if (prResult) {
      mockPrResultStore.delete(requestId);
      // The store holds the FLAT LandChangeResult — serve it verbatim.
      const prData = prResult;
      return NextResponse.json({
        status: "completed",
        result: {
          success: true,
          final_answer: "PR creation complete.",
          content: "PR creation complete.",
          // LandChangeResult nested under `result.pr`
          pr: prData,
        },
      });
    }

    // Default: completed (mermaid diagram for diagram agent tests)
    return NextResponse.json({
      status: "completed",
      result: {
        content:
          "```mermaid\ngraph TD\n  A[Client] --> B[API Route]\n  B --> C[repoAgent]\n  C --> D[Swarm]\n```",
      },
    });
  } catch (error) {
    console.error("[StakgraphMock] GET /progress error:", error);
    return NextResponse.json(
      { error: "Failed to get progress" },
      { status: 500 },
    );
  }
}
