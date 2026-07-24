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
 * URL — following the callback style of `src/app/api/mock/stakwork/run/route.ts`
 * and the agreed swarm payload contract:
 *   - Query string: `?id=<runId>` (the run id is parsed from `webhookUrl`)
 *   - Header:       `x-agent-run-token: <webhookToken>` (token from request body)
 *   - Body:         `{ status: "success"|"failed", content: "…" }`
 *
 * The callback fires after a short delay (500 ms) so the inline poll path
 * times out first (to simulate a long run), or immediately with `mode: "fail"`
 * to simulate a swarm failure. Set `webhookMode` in the body:
 *   - `"success"` (default) — fires a success callback after 500 ms
 *   - `"fail"` — fires a failed/aborted callback after 500 ms
 *   - `"inline"` — fires NO callback (the inline poll path should catch it)
 *
 * The inline short-run path continues to be exercised by the existing mock
 * progress route (`/api/mock/stakgraph/progress/route.ts`).
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
    const webhookToken = body.webhookToken as string | undefined;
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
        const callbackStatus = isSuccess ? "success" : "failed";
        const callbackContent = isSuccess
          ? "Mock workflow explorer result: found 3 matching workflows with video-to-transcript skills."
          : undefined;

        const callbackBody: Record<string, unknown> = { status: callbackStatus };
        if (callbackContent) callbackBody.content = callbackContent;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (webhookToken) {
          headers["x-agent-run-token"] = webhookToken;
        }

        fetch(webhookUrl, {
          method: "POST",
          headers,
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
