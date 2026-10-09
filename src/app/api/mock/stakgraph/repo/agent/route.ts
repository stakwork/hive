import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/config/env";
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
 * ## Security gate
 *
 * Returns 404 when `USE_MOCKS` is off OR when `NODE_ENV === "production"`.
 * The /api/mock subtree is publicly accessible at the middleware layer, so
 * this guard is required — not optional — now that these routes can
 * synthesize approval state.
 *
 * ## Webhook fan-back simulation
 *
 * When the request body contains a `webhookUrl` (set by the workflow-explorer
 * safety net), the mock schedules a simulated terminal callback POST to that
 * URL, mirroring stakgraph's real `postTerminalWebhook` exactly.
 *
 * ## Graph Agent Chat simulation
 *
 * When `mode: "graph"` is sent (the Graph Explorer chat dispatch), the
 * success callback carries a graph-flavored markdown answer echoing the
 * prompt. If the dispatch also enabled the proposal tools
 * (`toolsConfig.propose_concept_change`) and carries a `sessionId`, a canned
 * pending `MockProposal` tagged with that `sessionId` is inserted into the
 * stateful gitree proposal fixtures BEFORE the callback fires.
 */

// ─── Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Security gate: return 404 in production or when USE_MOCKS is off.
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

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional for polling-only tests.
    }

    const webhookUrl = body.webhookUrl as string | undefined;
    const webhookMode = (body.webhookMode as string | undefined) ?? "success";
    const isGraphMode = body.mode === "graph";
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId : undefined;
    const toolsConfig = (body.toolsConfig ?? {}) as Record<string, unknown>;
    const proposalsEnabled = toolsConfig.propose_concept_change === true;

    console.log(
      "[StakgraphMock] POST /repo/agent - returning mock request_id",
      {
        hasWebhookUrl: !!webhookUrl,
        webhookMode,
        isGraphMode,
        proposalsEnabled,
      },
    );

    const requestId = "mock-diagram-req-001";

    // ── Graph chat with proposals on ────────────────────────────────────
    if (isGraphMode && proposalsEnabled && sessionId && webhookMode === "success") {
      mockProposals.push({
        id: `proposal-graph-chat-${crypto.randomUUID()}`,
        action: "update",
        status: "pending",
        conceptId: "stakwork/hive/tasks",
        documentation:
          "Core task CRUD with dual status system (user vs workflow). The graph agent noted that task threads now group agent runs by sessionId.",
        baseDocs:
          "Core task CRUD with dual status system (user vs workflow).",
        rationale:
          "Filed by the mock graph agent from a proposals-enabled chat thread.",
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
        ? [
            "",
            "I filed one concept change proposal for review on the Learn page.",
          ]
        : []),
    ].join("\n");

    // ── Webhook fan-back simulation ────────────────────────────────────
    if (webhookUrl && webhookMode !== "inline") {
      const isSuccess = webhookMode !== "fail";

      setTimeout(() => {
        const callbackStatus = isSuccess ? "completed" : "failed";
        let successContent: string;

        if (isGraphMode) {
          successContent = graphContent;
        } else {
          successContent =
            "Mock workflow explorer result: found 3 matching workflows with video-to-transcript skills.";
        }

        const reflection =
          isGraphMode
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
              request_id: requestId,
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
              request_id: requestId,
              status: "failed",
              error: "aborted",
              retryable: false,
            };

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

    return NextResponse.json({ request_id: requestId });
  } catch (error) {
    console.error("[StakgraphMock] POST /repo/agent error:", error);
    return NextResponse.json(
      { error: "Failed to process repo agent request" },
      { status: 500 },
    );
  }
}
