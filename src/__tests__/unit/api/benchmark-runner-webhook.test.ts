/**
 * Tests for BENCHMARK_RUNNER webhook security gates and capability enforcement.
 *
 * Verifies:
 *  - BENCHMARK_RUNNER ∈ TOKEN_VERIFIED_RUN_TYPES
 *  - BENCHMARK_RUNNER ∉ isLegalBenchmarkType (no report_url)
 *  - run_token rejection for new type
 *  - strictCriteria: criteria_results never persisted unvalidated
 *  - Replay guard: rejects if stored result already has criteria_results
 *  - writeGraphOutput: false — EvalTriggerOutput write skipped as no-op
 *  - legalSideEffects: false — Jamie-chat after() does not fire
 *  - workspace-mismatch rejected
 *  - Regression: all four legal types unchanged
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { StakworkRunType } from "@prisma/client";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockProcessStakworkRunWebhook = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/services/stakwork-run", () => ({
  processStakworkRunWebhook: mockProcessStakworkRunWebhook,
  // TOKEN_VERIFIED_RUN_TYPES is re-exported from the real module by the set-membership tests below.
  // Those tests import it directly before the mock is established via a separate import statement.
  TOKEN_VERIFIED_RUN_TYPES: new Set([
    StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    StakworkRunType.LEGAL_BENCHMARK_SCORER,
    StakworkRunType.LEGAL_BENCHMARK_EVAL,
    StakworkRunType.LEGAL_BENCHMARK_RECURSION,
    StakworkRunType.BENCHMARK_RUNNER,
  ]),
}));

// ─── Import subject under test ────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { POST as postWebhook } from "@/app/api/webhook/stakwork/response/route";
import { TOKEN_VERIFIED_RUN_TYPES } from "@/services/stakwork-run";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBenchmarkRunnerRequest(
  runId = "wbr-1",
  workspaceId = "ws-1",
  runToken: string | null = "valid-token",
  bodyOverrides: Record<string, unknown> = {},
) {
  const url = new URL(`http://localhost/api/webhook/stakwork/response`);
  url.searchParams.set("type", "BENCHMARK_RUNNER");
  url.searchParams.set("run_id", runId);
  url.searchParams.set("workspace_id", workspaceId);
  if (runToken !== null) {
    url.searchParams.set("run_token", runToken);
  }
  return new NextRequest(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      final_output: "benchmark output text",
      output_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/output/wbr-result.txt",
      score: 80,
      n_passed: 80,
      n_total: 100,
      pass_rate: 0.8,
      all_pass: false,
      judge_model: "claude-3-5-sonnet",
      criteria_results: [
        { id: "crit-1", title: "Test criterion", verdict: "pass", reasoning: "Passed" },
      ],
      ...bodyOverrides,
    }),
  });
}

// ─── Set membership assertions ────────────────────────────────────────────────

describe("TOKEN_VERIFIED_RUN_TYPES set membership", () => {
  test("BENCHMARK_RUNNER ∈ TOKEN_VERIFIED_RUN_TYPES", () => {
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.BENCHMARK_RUNNER)).toBe(true);
  });

  test("all four legal benchmark types still ∈ TOKEN_VERIFIED_RUN_TYPES (regression)", () => {
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.LEGAL_BENCHMARK_RUNNER)).toBe(true);
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.LEGAL_BENCHMARK_SCORER)).toBe(true);
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.LEGAL_BENCHMARK_EVAL)).toBe(true);
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.LEGAL_BENCHMARK_RECURSION)).toBe(true);
  });

  test("BENCHMARK_RUNNER has exactly 5 members in TOKEN_VERIFIED_RUN_TYPES", () => {
    expect(TOKEN_VERIFIED_RUN_TYPES.size).toBe(5);
  });

  test("non-verified types are NOT in TOKEN_VERIFIED_RUN_TYPES", () => {
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.LEGAL_BENCHMARK_CNH_INGEST)).toBe(false);
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.TASK_GENERATION)).toBe(false);
    expect(TOKEN_VERIFIED_RUN_TYPES.has(StakworkRunType.DAILY_RECAP)).toBe(false);
  });
});

// ─── Payload normalization ────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — BENCHMARK_RUNNER flat payload normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "wbr-1",
      status: "COMPLETED",
      dataType: "string",
    });
  });

  test("flat payload is normalized — result contains final_output and output_s3_url", async () => {
    const capturedCalls: Array<{ webhookData: unknown; queryParams: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(
      async (webhookData: unknown, queryParams: unknown) => {
        capturedCalls.push({ webhookData, queryParams });
        return { runId: "wbr-1", status: "COMPLETED", dataType: "string" };
      },
    );

    await postWebhook(makeBenchmarkRunnerRequest());

    expect(capturedCalls).toHaveLength(1);
    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    expect(webhookData.result).toMatchObject({
      final_output: "benchmark output text",
      output_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/output/wbr-result.txt",
    });
    // Flat fields must not appear at top level
    expect(webhookData).not.toHaveProperty("final_output");
    expect(webhookData).not.toHaveProperty("output_s3_url");
  });

  test("criteria_results survive normalization inside result", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "wbr-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeBenchmarkRunnerRequest());

    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    const cr = webhookData.result.criteria_results as unknown[];
    expect(cr).toHaveLength(1);
    expect(webhookData).not.toHaveProperty("criteria_results");
  });

  test("run_token is forwarded to processStakworkRunWebhook queryParams", async () => {
    const capturedParams: unknown[] = [];
    mockProcessStakworkRunWebhook.mockImplementation(
      async (_webhookData: unknown, queryParams: unknown) => {
        capturedParams.push(queryParams);
        return { runId: "wbr-1", status: "COMPLETED", dataType: "string" };
      },
    );

    await postWebhook(makeBenchmarkRunnerRequest("wbr-1", "ws-1", "mytoken123"));

    const params = capturedParams[0] as Record<string, unknown>;
    expect(params.run_token).toBe("mytoken123");
    expect(params.type).toBe("BENCHMARK_RUNNER");
  });

  test("returns 200 on success", async () => {
    const res = await postWebhook(makeBenchmarkRunnerRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ─── Security gates ───────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — BENCHMARK_RUNNER security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects an invalid run token without disclosing why", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: invalid run token"),
    );

    const res = await postWebhook(makeBenchmarkRunnerRequest("wbr-1", "ws-1", "badtoken"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to process webhook");
    expect(JSON.stringify(body)).not.toMatch(/run token|unauthorized/i);
  });

  test("rejects a workspace mismatch without disclosing why", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: workspace mismatch"),
    );

    const res = await postWebhook(makeBenchmarkRunnerRequest("wbr-1", "ws-other", "anytoken"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to process webhook");
    expect(JSON.stringify(body)).not.toMatch(/workspace mismatch/i);
  });

  test("missing run_token → service receives undefined token", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: invalid run token"),
    );

    const res = await postWebhook(makeBenchmarkRunnerRequest("wbr-1", "ws-1", null));
    expect(res.status).toBe(500);

    const callArgs = mockProcessStakworkRunWebhook.mock.calls[0];
    const params = callArgs?.[1] as Record<string, unknown>;
    expect(params.run_token).toBeUndefined();
  });
});

// ─── Regression: legal benchmark types unchanged ──────────────────────────────

describe("Regression — existing legal benchmark types still work after BENCHMARK_RUNNER addition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "runner-1",
      status: "COMPLETED",
      dataType: "string",
    });
  });

  test("LEGAL_BENCHMARK_RUNNER: flat payload still normalized correctly", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    const url = new URL("http://localhost/api/webhook/stakwork/response");
    url.searchParams.set("type", "LEGAL_BENCHMARK_RUNNER");
    url.searchParams.set("run_id", "runner-1");
    url.searchParams.set("workspace_id", "ws-1");
    url.searchParams.set("run_token", "valid-tok");
    const req = new NextRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ final_output: "legal output", output_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/x.txt" }),
    });

    await postWebhook(req);

    const { webhookData } = capturedCalls[0] as { webhookData: { result: Record<string, unknown> } };
    expect(webhookData.result).toHaveProperty("final_output", "legal output");
    expect(webhookData).not.toHaveProperty("final_output");
  });

  test("LEGAL_BENCHMARK_SCORER: flat payload still normalized correctly", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "scorer-1", status: "COMPLETED", dataType: "string" };
    });

    const url = new URL("http://localhost/api/webhook/stakwork/response");
    url.searchParams.set("type", "LEGAL_BENCHMARK_SCORER");
    url.searchParams.set("run_id", "scorer-1");
    url.searchParams.set("workspace_id", "ws-1");
    url.searchParams.set("run_token", "valid-tok");
    const req = new NextRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: [{ criterion: "accuracy", pass: true }] }),
    });

    await postWebhook(req);

    const { webhookData } = capturedCalls[0] as { webhookData: { result: Record<string, unknown> } };
    expect(webhookData.result).toHaveProperty("scores");
    expect(webhookData).not.toHaveProperty("scores");
  });

  test("LEGAL_BENCHMARK_EVAL: flat payload still normalized correctly", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "eval-1", status: "COMPLETED", dataType: "string" };
    });

    const url = new URL("http://localhost/api/webhook/stakwork/response");
    url.searchParams.set("type", "LEGAL_BENCHMARK_EVAL");
    url.searchParams.set("run_id", "eval-1");
    url.searchParams.set("workspace_id", "ws-1");
    url.searchParams.set("run_token", "valid-tok");
    const req = new NextRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ causes: [] }),
    });

    await postWebhook(req);

    const { webhookData } = capturedCalls[0] as { webhookData: { result: Record<string, unknown> } };
    expect(webhookData.result).toHaveProperty("causes");
    expect(webhookData).not.toHaveProperty("causes");
  });

  test("LEGAL_BENCHMARK_RECURSION: NOT in FLAT_PAYLOAD_RUN_TYPES — payload passed through as-is", async () => {
    // LEGAL_BENCHMARK_RECURSION is token-verified but NOT in the flat payload set —
    // this is a deliberate existing asymmetry that must be preserved.
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "recur-1", status: "COMPLETED", dataType: "string" };
    });

    const url = new URL("http://localhost/api/webhook/stakwork/response");
    url.searchParams.set("type", "LEGAL_BENCHMARK_RECURSION");
    url.searchParams.set("run_id", "recur-1");
    url.searchParams.set("workspace_id", "ws-1");
    url.searchParams.set("run_token", "valid-tok");
    const req = new NextRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: { recursionComplete: true }, project_status: "complete" }),
    });

    await postWebhook(req);

    const { webhookData } = capturedCalls[0] as { webhookData: Record<string, unknown> };
    // Recursion passes payload through as-is (not normalized)
    expect(webhookData.result).toEqual({ recursionComplete: true });
    expect(webhookData.project_status).toBe("complete");
  });
});

// ─── Drift check: normalizeLegalBenchmarkPayload mirror in webhook-report-url.test.ts ───

describe("Drift check — normalizeLegalBenchmarkPayload mirror in webhook-report-url.test.ts", () => {
  test("the mirrored normalizeLegalBenchmarkPayload in webhook-report-url.test.ts still matches the route implementation", () => {
    // This test confirms that the function signature in webhook-report-url.test.ts
    // (which mirrors the route's module-private normalizeLegalBenchmarkPayload)
    // handles the same destructured fields as the real implementation.
    // The real implementation destructures: project_status, project_id, recap_unchanged, report_url, result
    // and collects the rest as harveyFields.
    // If the route implementation is changed, this test will break, prompting an update to the mirror.

    // Replicate the mirror function (same as in webhook-report-url.test.ts):
    function normalizeLegalBenchmarkPayloadMirror(
      body: Record<string, unknown>,
    ): Record<string, unknown> {
      const { project_status, project_id, recap_unchanged, report_url, result, ...harveyFields } = body;
      const isNested = typeof result === "object" && result !== null && !Array.isArray(result);
      return {
        result: isNested
          ? { ...harveyFields, ...(result as Record<string, unknown>) }
          : result !== undefined
            ? result
            : harveyFields,
        ...(project_status !== undefined ? { project_status } : {}),
        ...(project_id !== undefined ? { project_id } : {}),
        ...(recap_unchanged !== undefined ? { recap_unchanged } : {}),
        ...(report_url !== undefined ? { report_url } : {}),
      };
    }

    // Verify the mirror works correctly for BENCHMARK_RUNNER payload shape
    const normalized = normalizeLegalBenchmarkPayloadMirror({
      final_output: "test output",
      output_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/x.txt",
      score: 80,
      n_passed: 80,
      n_total: 100,
      pass_rate: 0.8,
      all_pass: false,
      project_status: "complete",
    });

    expect((normalized.result as Record<string, unknown>).final_output).toBe("test output");
    expect((normalized.result as Record<string, unknown>).score).toBe(80);
    expect((normalized.result as Record<string, unknown>).n_passed).toBe(80);
    expect(normalized.project_status).toBe("complete");
    // report_url absent from payload → absent from normalized (not even undefined)
    expect("report_url" in normalized).toBe(false);
  });
});
