import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Repo Agent Endpoint
 *
 * Simulates: POST https://{swarm}:3355/repo/agent
 *
 * Accepts a prompt (with optional skills) and returns a mock request_id
 * that can be polled via GET /api/mock/stakgraph/progress.
 *
 * ## Webhook fan-back simulation
 *
 * When the request body contains a `webhookUrl` (set by the workflow-explorer
 * safety net), the mock schedules a simulated terminal callback POST to that
 * URL, mirroring stakgraph's real `postTerminalWebhook` (stakgraph
 * `mcp/src/repo/index.ts`) exactly:
 *   - The registered `webhookUrl` is POSTed verbatim (id + bearer token both
 *     ride in its query string; stakgraph attaches NO custom headers)
 *   - Body on success: `{ request_id, status: "completed", result: {
 *     success, final_answer, content, ... } }`
 *   - Body on failure: `{ request_id, status: "failed", error }`
 *
 * The callback fires after a short delay (500 ms) so the inline poll path
 * times out first (to simulate a long run), or immediately with `mode: "fail"`
 * to simulate a swarm failure. Set `webhookMode` in the body:
 *   - `"success"` (default) — fires a completed callback after 500 ms
 *   - `"fail"` — fires a failed/aborted callback after 500 ms
 *   - `"inline"` — fires NO callback. For canvas dispatch-only runs this
 *     simulates a lost webhook (row stays PENDING); for non-canvas callers
 *     the inline poll path picks the result up from the progress route.
 *
 * The poll path continues to be exercised by the existing mock progress
 * route (`/api/mock/stakgraph/progress/route.ts`).
 */
export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional for polling-only tests.
    }

    const webhookUrl = body.webhookUrl as string | undefined;
    const webhookMode = (body.webhookMode as string | undefined) ?? "success";

    console.log("[StakgraphMock] POST /repo/agent - returning mock request_id", {
      hasWebhookUrl: !!webhookUrl,
      webhookMode,
    });

    // Schedule a simulated terminal callback when webhookUrl is present and
    // webhookMode is not "inline" (inline mode is exercised by the poll route).
    if (webhookUrl && webhookMode !== "inline") {
      const isSuccess = webhookMode !== "fail";

      // Fire after a short delay to allow the response to return first.
      setTimeout(() => {
        // Mirror stakgraph's TerminalWebhookPayload shape exactly.
        const callbackStatus = isSuccess ? "completed" : "failed";
        const callbackBody: Record<string, unknown> = isSuccess
          ? {
              request_id: "mock-diagram-req-001",
              status: "completed",
              result: {
                success: true,
                final_answer:
                  "Mock workflow explorer result: found 3 matching workflows with video-to-transcript skills.",
                content:
                  "Mock workflow explorer result: found 3 matching workflows with video-to-transcript skills.",
              },
            }
          : {
              request_id: "mock-diagram-req-001",
              status: "failed",
              error: "aborted",
            };

        // stakgraph sends no custom headers — the bearer token is already
        // inside webhookUrl's query string.
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(callbackBody),
        })
          .then((res) => {
            console.log("[StakgraphMock] webhook callback fired", {
              webhookStatus: res.status,
              callbackStatus,
            });
          })
          .catch((err) => {
            console.error("[StakgraphMock] webhook callback error", err);
          });
      }, 500);
    }

    return NextResponse.json({ request_id: "mock-diagram-req-001" });
  } catch (error) {
    console.error("[StakgraphMock] POST /repo/agent error:", error);
    return NextResponse.json({ error: "Failed to process repo agent request" }, { status: 500 });
  }
}
