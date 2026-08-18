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
 * synthesize PR/approval state.
 *
 * ## create_pr recognition
 *
 * When the request body contains `toolsConfig.create_pr: true`, this handler
 * simulates a landed PR (LandChangeResult success) and stores the result in
 * the shared mock progress store so `GET /progress?request_id=...` returns it
 * under `result.pr` in a terminal payload.
 *
 * Admission-failure scenarios are reproduced as real HTTP statuses (not
 * in-band results) to match the real swarm's pre-flight behavior:
 *   - `mockCreatePrScenario: "unauth"`        → 401
 *   - `mockCreatePrScenario: "multi_repo"`    → 400 (LAND_CHANGE_ERR_MULTI_REPO)
 *   - `mockCreatePrScenario: "empty_pat"`     → 400 (LAND_CHANGE_ERR_EMPTY_PAT)
 *   - `mockCreatePrScenario: "identity"`      → 400 (failure: "identity_mismatch")
 *   - `mockCreatePrScenario: "no_push"`       → 403 (failure: "no_push_permission")
 *   - `mockCreatePrScenario: "rate_limited"`  → 429 (failure: "rate_limited")
 *   - Any other value / absent              → success (LandChangeSuccess)
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

// ─── Shared mock progress store ───────────────────────────────────────────
// Keyed by request_id.  Consumed by GET /progress?request_id=...
// (The progress route imports this map if it needs persistent state, but
//  for now we use a module-level map that's in-process for the server run.)

export const mockPrResultStore = new Map<
  string,
  { ok: true; pr: Record<string, unknown> } | { ok: false; failure: string }
>();

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
    const isCreatePrRun = toolsConfig.create_pr === true;
    const mockCreatePrScenario = body.mockCreatePrScenario as
      | string
      | undefined;

    console.log(
      "[StakgraphMock] POST /repo/agent - returning mock request_id",
      {
        hasWebhookUrl: !!webhookUrl,
        webhookMode,
        isGraphMode,
        proposalsEnabled,
        isCreatePrRun,
        mockCreatePrScenario,
      },
    );

    // ── Admission failures for create_pr runs ──────────────────────────
    // Reproduced as real HTTP statuses, not in-band results, mirroring the
    // real swarm's pre-flight behavior.
    if (isCreatePrRun && mockCreatePrScenario) {
      switch (mockCreatePrScenario) {
        case "unauth":
          return NextResponse.json(
            {
              error:
                "create_pr requires API_TOKEN to be configured",
            },
            { status: 401 },
          );
        case "multi_repo":
          return NextResponse.json(
            {
              error:
                "create_pr requires exactly one explicit repo_url " +
                "(no comma-separated list, no omission)",
            },
            { status: 400 },
          );
        case "empty_pat":
          return NextResponse.json(
            { error: "create_pr requires a non-empty pat" },
            { status: 400 },
          );
        case "identity":
          return NextResponse.json(
            { failure: "identity_mismatch", error: "Token login 'x' does not match supplied username 'y'" },
            { status: 400 },
          );
        case "no_push":
          return NextResponse.json(
            {
              failure: "no_push_permission",
              error: "no_push_permission: PAT does not have push access to this repo",
            },
            { status: 403 },
          );
        case "rate_limited":
          return NextResponse.json(
            {
              failure: "rate_limited",
              error: "rate_limited: too many PRs landed in this hour",
            },
            { status: 429 },
          );
        default:
          break;
      }
    }

    // ── Stable request_id ──────────────────────────────────────────────
    const requestId = isCreatePrRun
      ? `mock-create-pr-req-${crypto.randomUUID().slice(0, 8)}`
      : "mock-diagram-req-001";

    // ── Prepare create_pr result for the progress store ────────────────
    if (isCreatePrRun) {
      const repoUrl =
        (body.repo_url as string | undefined) ??
        "https://github.com/stakwork/hive";
      const prTitle =
        typeof body.prompt === "string"
          ? body.prompt.match(/title="([^"]+)"/)?.[1] ?? "[Jamie] Mock change"
          : "[Jamie] Mock change";

      // Default scenario: success
      const prResult = {
        ok: true as const,
        url: `${repoUrl}/pull/42`,
        number: 42,
        branch: `swarm/swarm-change-${requestId.slice(-8)}`,
        base: "main",
        headSha: "abc123def456abc123def456abc123def456abc1",
        diff:
          "--- a/src/example.ts\n" +
          "+++ b/src/example.ts\n" +
          "@@ -1,3 +1,4 @@\n" +
          " const x = 1;\n" +
          "+const y = 2;\n" +
          " export { x };\n",
        filesChanged: 1,
        title: prTitle,
      };

      // Store for the progress route to serve.
      mockPrResultStore.set(requestId, { ok: true, pr: prResult });
    }

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

        if (isCreatePrRun) {
          successContent = JSON.stringify({ pr: mockPrResultStore.get(requestId) });
        } else if (isGraphMode) {
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
                // For create_pr runs, nest the PR result under `result.pr`
                ...(isCreatePrRun
                  ? { pr: mockPrResultStore.get(requestId) }
                  : {}),
                ...(reflection ? { reflection } : {}),
              },
            }
          : {
              request_id: requestId,
              status: "failed",
              error: "aborted",
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
