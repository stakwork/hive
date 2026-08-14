import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { mockProposals } from "@/app/api/mock/stakgraph/gitree/proposals/fixtures";

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
 *
 * ## Graph Agent Chat simulation
 *
 * When `mode: "graph"` is sent (the Graph Explorer chat dispatch), the
 * success callback carries a graph-flavored markdown answer echoing the
 * prompt. If the dispatch also enabled the proposal tools
 * (`toolsConfig.propose_concept_change`) and carries a `sessionId`, a canned
 * pending `MockProposal` tagged with that `sessionId` is inserted into the
 * stateful gitree proposal fixtures BEFORE the callback fires — so the chip
 * flow (webhook nudge → proposals fetch → sessionIds filter) is testable
 * end-to-end against the mocks.
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
    const isGraphMode = body.mode === "graph";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
    const toolsConfig = (body.toolsConfig ?? {}) as Record<string, unknown>;
    const proposalsEnabled = toolsConfig.propose_concept_change === true;

    console.log("[StakgraphMock] POST /repo/agent - returning mock request_id", {
      hasWebhookUrl: !!webhookUrl,
      webhookMode,
      isGraphMode,
      proposalsEnabled,
    });

    // Graph chat with proposals on: file a canned pending proposal tagged
    // with this session BEFORE the terminal callback fires, so the chip flow
    // finds it as soon as the run completes.
    if (isGraphMode && proposalsEnabled && sessionId && webhookMode === "success") {
      mockProposals.push({
        id: `proposal-graph-chat-${crypto.randomUUID()}`,
        action: "update",
        status: "pending",
        conceptId: "stakwork/hive/tasks",
        documentation:
          "Core task CRUD with dual status system (user vs workflow). The graph agent noted that task threads now group agent runs by sessionId.",
        baseDocs: "Core task CRUD with dual status system (user vs workflow).",
        rationale: "Filed by the mock graph agent from a proposals-enabled chat thread.",
        source: "graph_chat",
        prNumbers: [],
        sessionIds: [sessionId],
        createdAt: new Date().toISOString(),
        repo: "stakwork/hive",
      });
    }

    const graphContent = [
      "## Mock graph agent answer",
      "",
      `You asked: ${typeof body.prompt === "string" ? body.prompt.slice(0, 200) : "(no prompt)"}`,
      "",
      "The workspace graph contains **5 concepts**; `stakwork/hive/tasks` is the most connected node.",
      ...(proposalsEnabled
        ? ["", "I filed one concept change proposal for review on the Learn page."]
        : []),
    ].join("\n");

    // Schedule a simulated terminal callback when webhookUrl is present and
    // webhookMode is not "inline" (inline mode is exercised by the poll route).
    if (webhookUrl && webhookMode !== "inline") {
      const isSuccess = webhookMode !== "fail";

      // Fire after a short delay to allow the response to return first.
      setTimeout(() => {
        // Mirror stakgraph's TerminalWebhookPayload shape exactly.
        const callbackStatus = isSuccess ? "completed" : "failed";
        const successContent = isGraphMode
          ? graphContent
          : "Mock workflow explorer result: found 3 matching workflows with video-to-transcript skills.";
        // Graph runs also carry the Concept-reads reflection sidecar, exactly
        // as stakgraph's terminal payload does (reads recorded, rank null —
        // graph chat does not opt into the reflect ranking pass).
        const reflection = isGraphMode
          ? {
              session_id: sessionId,
              updated_at: new Date().toISOString(),
              concepts: [
                {
                  id: "stakwork/hive/tasks",
                  name: "Tasks",
                  repo: "stakwork/hive",
                  read_order: 1,
                  rank: null,
                },
                {
                  id: "stakwork/hive/auth",
                  name: "Authentication",
                  repo: "stakwork/hive",
                  read_order: 2,
                  rank: null,
                },
              ],
            }
          : undefined;
        const callbackBody: Record<string, unknown> = isSuccess
          ? {
              request_id: "mock-diagram-req-001",
              status: "completed",
              result: {
                success: true,
                final_answer: successContent,
                content: successContent,
                sessionId,
                ...(reflection ? { reflection } : {}),
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
