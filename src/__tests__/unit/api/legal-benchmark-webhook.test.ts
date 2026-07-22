/**
 * Tests for the LEGAL_BENCHMARK type-gated branch in the generic
 * POST /api/webhook/stakwork/response route.
 *
 * These tests verify:
 *  - Flat Harvey payload normalization into { result: {...} }
 *  - run_token is forwarded to processStakworkRunWebhook
 *  - Security: missing/invalid token → 500
 *  - Security: workspace mismatch → 500
 *  - SSRF: disallowed output_s3_url → 500 (service throws)
 *  - Flat score fields are normalized into result
 *  - Scorer drain: LEGAL_BENCHMARK_SCORER webhook terminates cleanly without dispatch
 *  - Non-legal-benchmark types are NOT normalized
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockProcessStakworkRunWebhook = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/services/stakwork-run", () => ({
  processStakworkRunWebhook: mockProcessStakworkRunWebhook,
}));

// ─── Import subject under test ────────────────────────────────────────────────

import { POST as postWebhook } from "@/app/api/webhook/stakwork/response/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWebhookRequest(
  type: string,
  runId: string,
  workspaceId: string,
  runToken: string | null,
  body: Record<string, unknown>,
) {
  const url = new URL(`http://localhost/api/webhook/stakwork/response`);
  url.searchParams.set("type", type);
  url.searchParams.set("run_id", runId);
  url.searchParams.set("workspace_id", workspaceId);
  if (runToken !== null) {
    url.searchParams.set("run_token", runToken);
  }
  return new NextRequest(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRunnerRequest(
  runId = "runner-1",
  workspaceId = "ws-1",
  runToken = "valid-token",
  bodyOverrides: Record<string, unknown> = {},
) {
  return makeWebhookRequest("LEGAL_BENCHMARK_RUNNER", runId, workspaceId, runToken, {
    final_output: "runner output text",
    output_s3_url:
      "https://stakwork-uploads.s3.us-east-1.amazonaws.com/output/runner-result.txt",
    ...bodyOverrides,
  });
}

function makeScorerRequest(
  runId = "scorer-1",
  workspaceId = "ws-1",
  runToken = "valid-token",
  bodyOverrides: Record<string, unknown> = {},
) {
  return makeWebhookRequest("LEGAL_BENCHMARK_SCORER", runId, workspaceId, runToken, {
    scores: [{ criterion: "accuracy", pass: true, notes: "good" }],
    ...bodyOverrides,
  });
}

/** Runner webhook body with full inline score fields (workflow 57179 output shape) */
function makeRunnerWithScoreRequest(
  runId = "runner-1",
  workspaceId = "ws-1",
  runToken = "valid-token",
  bodyOverrides: Record<string, unknown> = {},
) {
  return makeWebhookRequest("LEGAL_BENCHMARK_RUNNER", runId, workspaceId, runToken, {
    final_output: "runner output text",
    output_s3_url:
      "https://stakwork-uploads.s3.us-east-1.amazonaws.com/output/runner-result.txt",
    score: 72,
    max_score: 74,
    n_passed: 72,
    n_total: 74,
    pass_rate: 0.973,
    all_pass: true,
    scores_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/scores/breakdown.json",
    judge_model: "claude-3-5-sonnet",
    project_status: "complete",
    project_id: 9999,
    ...bodyOverrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — LEGAL_BENCHMARK flat payload normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "runner-1",
      status: "COMPLETED",
      dataType: "string",
    });
  });

  test("runner: flat Harvey payload is normalized — result contains final_output and output_s3_url", async () => {
    const capturedCalls: Array<{ webhookData: unknown; queryParams: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(
      async (webhookData: unknown, queryParams: unknown) => {
        capturedCalls.push({ webhookData, queryParams });
        return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
      },
    );

    await postWebhook(makeRunnerRequest());

    expect(capturedCalls).toHaveLength(1);
    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    expect(webhookData.result).toMatchObject({
      final_output: "runner output text",
      output_s3_url:
        "https://stakwork-uploads.s3.us-east-1.amazonaws.com/output/runner-result.txt",
    });
    // Harvey keys must NOT appear at the top level after normalization
    expect(webhookData).not.toHaveProperty("final_output");
    expect(webhookData).not.toHaveProperty("output_s3_url");
  });

  test("runner: flat score fields (n_passed, n_total, all_pass, etc.) are normalized into result", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeRunnerWithScoreRequest());

    expect(capturedCalls).toHaveLength(1);
    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    // All score fields must be nested under result
    expect(webhookData.result).toMatchObject({
      score: 72,
      max_score: 74,
      n_passed: 72,
      n_total: 74,
      pass_rate: 0.973,
      all_pass: true,
      scores_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/scores/breakdown.json",
      judge_model: "claude-3-5-sonnet",
    });
    // Score fields must NOT appear at the top level
    expect(webhookData).not.toHaveProperty("n_passed");
    expect(webhookData).not.toHaveProperty("all_pass");
    expect(webhookData).not.toHaveProperty("judge_model");
  });

  test("scorer: flat Harvey payload is normalized — result contains scores", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "scorer-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeScorerRequest());

    expect(capturedCalls).toHaveLength(1);
    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    expect(webhookData.result).toMatchObject({
      scores: [{ criterion: "accuracy", pass: true, notes: "good" }],
    });
    expect(webhookData).not.toHaveProperty("scores");
  });

  test("project_status and project_id remain as top-level fields after normalization", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(
      makeRunnerRequest("runner-1", "ws-1", "tok", {
        project_status: "complete",
        project_id: 42,
      }),
    );

    const { webhookData } = capturedCalls[0] as { webhookData: Record<string, unknown> };
    expect(webhookData.project_status).toBe("complete");
    expect(webhookData.project_id).toBe(42);
    // These should NOT appear in result (they're kept at top level)
    expect((webhookData.result as Record<string, unknown>).project_status).toBeUndefined();
    expect((webhookData.result as Record<string, unknown>).project_id).toBeUndefined();
  });

  test("run_token is forwarded to processStakworkRunWebhook queryParams", async () => {
    const capturedParams: unknown[] = [];
    mockProcessStakworkRunWebhook.mockImplementation(
      async (_webhookData: unknown, queryParams: unknown) => {
        capturedParams.push(queryParams);
        return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
      },
    );

    await postWebhook(makeRunnerRequest("runner-1", "ws-1", "mytoken123"));

    const params = capturedParams[0] as Record<string, unknown>;
    expect(params.run_token).toBe("mytoken123");
    expect(params.run_id).toBe("runner-1");
    expect(params.workspace_id).toBe("ws-1");
  });

  test("run_token is undefined in queryParams when omitted from URL", async () => {
    const capturedParams: unknown[] = [];
    mockProcessStakworkRunWebhook.mockImplementation(
      async (_webhookData: unknown, queryParams: unknown) => {
        capturedParams.push(queryParams);
        return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
      },
    );

    await postWebhook(makeWebhookRequest("LEGAL_BENCHMARK_RUNNER", "runner-1", "ws-1", null, {
      final_output: "text",
    }));

    const params = capturedParams[0] as Record<string, unknown>;
    expect(params.run_token).toBeUndefined();
  });

  test("non-legal-benchmark types are NOT normalized (result passed as-is)", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "run-1", status: "COMPLETED", dataType: "string" };
    });

    const url = new URL(`http://localhost/api/webhook/stakwork/response`);
    url.searchParams.set("type", "TASK_GENERATION");
    url.searchParams.set("workspace_id", "ws-1");
    const req = new NextRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: { phases: [] }, project_status: "complete" }),
    });
    await postWebhook(req);

    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    expect(webhookData.result).toEqual({ phases: [] });
  });

  test("returns 200 with runId on success", async () => {
    const res = await postWebhook(makeRunnerRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.runId).toBe("runner-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scorer drain: LEGAL_BENCHMARK_SCORER webhook terminates cleanly
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — scorer drain (legacy rows)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("LEGAL_BENCHMARK_SCORER webhook is accepted and returns 200 (drain path)", async () => {
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "scorer-legacy",
      status: "COMPLETED",
      dataType: "string",
    });

    const res = await postWebhook(makeScorerRequest("scorer-legacy", "ws-1", "valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.runId).toBe("scorer-legacy");
  });

  test("scorer webhook: service receives normalized payload with scores in result", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "scorer-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeScorerRequest());

    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    // Scores are in result, not at top level
    expect(webhookData.result).toHaveProperty("scores");
    expect(webhookData).not.toHaveProperty("scores");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: run_token verification (service throws → route returns 500)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — run_token security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 500 when service throws Unauthorized: invalid run token", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: invalid run token"),
    );

    const res = await postWebhook(makeRunnerRequest("runner-1", "ws-1", "badtoken"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized.*invalid run token/i);
  });

  test("returns 500 when service throws workspace mismatch error", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: workspace mismatch"),
    );

    const res = await postWebhook(makeRunnerRequest("runner-1", "ws-other", "anytoken"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/workspace mismatch/i);
  });

  test("missing run_token → service receives undefined token and can reject", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("Unauthorized: invalid run token"),
    );

    // No run_token in URL
    const res = await postWebhook(
      makeWebhookRequest("LEGAL_BENCHMARK_RUNNER", "runner-1", "ws-1", null, {
        final_output: "text",
      }),
    );
    expect(res.status).toBe(500);

    // Confirm run_token was absent in the forwarded params
    const callArgs = mockProcessStakworkRunWebhook.mock.calls[0];
    const params = callArgs?.[1] as Record<string, unknown>;
    expect(params.run_token).toBeUndefined();
  });

  test("returns 200 when service resolves successfully", async () => {
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "runner-1",
      status: "COMPLETED",
      dataType: "string",
    });

    const res = await postWebhook(makeRunnerRequest("runner-1", "ws-1", "valid-token"));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: SSRF / disallowed output_s3_url (service throws → route returns 500)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — SSRF output_s3_url guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("service throwing SSRF error surfaces as 500", async () => {
    mockProcessStakworkRunWebhook.mockRejectedValue(
      new Error("output_s3_url not on allowlist"),
    );

    // The normalization still wraps the payload; the service enforces the SSRF check
    const res = await postWebhook(
      makeRunnerRequest("runner-1", "ws-1", "tok", {
        output_s3_url: "https://attacker.example.com/evil-file",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/allowlist/i);
  });

  test("valid allowlisted S3 URL succeeds", async () => {
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "runner-1",
      status: "COMPLETED",
      dataType: "string",
    });

    const res = await postWebhook(makeRunnerRequest());
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Result merge: correlation fields not clobbered (verified at service level via payload)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — payload reaches service correctly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessStakworkRunWebhook.mockResolvedValue({
      runId: "runner-1",
      status: "COMPLETED",
      dataType: "string",
    });
  });

  test("Harvey output fields are inside result, not mixed with correlation metadata", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeRunnerRequest());

    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    // Harvey fields are nested under result
    expect(webhookData.result).toHaveProperty("final_output");
    expect(webhookData.result).toHaveProperty("output_s3_url");
    // They are NOT at the top level (would clobber correlation data in result JSON)
    expect(webhookData).not.toHaveProperty("final_output");
    expect(webhookData).not.toHaveProperty("output_s3_url");
  });

  test("scorer scores are inside result, not at top level", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "scorer-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeScorerRequest());

    const { webhookData } = capturedCalls[0] as {
      webhookData: { result: Record<string, unknown> };
    };
    expect(webhookData.result).toHaveProperty("scores");
    expect(webhookData).not.toHaveProperty("scores");
  });

  test("full runner+score payload: all fields correctly placed in result", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeRunnerWithScoreRequest());

    const { webhookData } = capturedCalls[0] as {
      webhookData: Record<string, unknown> & { result: Record<string, unknown> };
    };
    // project_status / project_id at top level
    expect(webhookData.project_status).toBe("complete");
    expect(webhookData.project_id).toBe(9999);
    // All harvest fields nested under result
    expect(webhookData.result.final_output).toBe("runner output text");
    expect(webhookData.result.n_passed).toBe(72);
    expect(webhookData.result.all_pass).toBe(true);
    expect(webhookData.result.judge_model).toBe("claude-3-5-sonnet");
    // Top level must not contain score fields
    expect(webhookData).not.toHaveProperty("n_passed");
    expect(webhookData).not.toHaveProperty("all_pass");
    expect(webhookData).not.toHaveProperty("judge_model");
  });

  test("criteria_results array survives normalization intact in result", async () => {
    const criteriaResults = [
      { id: "crit-1", title: "Accuracy", verdict: "pass", reasoning: "Well done" },
      { id: "crit-2", title: "Completeness", verdict: "fail", reasoning: "Missing section" },
    ];
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeRunnerWithScoreRequest("runner-1", "ws-1", "valid-token", { criteria_results: criteriaResults }));

    const { webhookData } = capturedCalls[0] as {
      webhookData: Record<string, unknown> & { result: Record<string, unknown> };
    };
    expect(webhookData.result.criteria_results).toEqual(criteriaResults);
    // Must not be at top level
    expect(webhookData).not.toHaveProperty("criteria_results");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clobber protection: requestedModel/requestedJudgeModel not overwritten by
// runner webhook echo of judge_model (via RunnerScoreSchema)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/stakwork/response — requestedModel/requestedJudgeModel clobber protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The runner webhook echoes `judge_model` (and potentially `model`) via RunnerScoreSchema.
   * processLegalBenchmarkRunnerWebhook merges incoming score fields on top of the existing
   * stored result. Since the operator's choices are stored under `requestedModel` /
   * `requestedJudgeModel` — keys the runner NEVER emits — they survive the spread untouched.
   *
   * We verify this by capturing the exact `webhookData.result` that reaches the service
   * and asserting the separation of key namespaces.
   */
  test("runner webhook with judge_model echo does NOT contain requestedModel or requestedJudgeModel keys (those are operator-only)", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    // Runner webhook with full inline score fields (including judge_model echo)
    await postWebhook(makeRunnerWithScoreRequest("runner-1", "ws-1", "valid-token", {
      judge_model: "claude-sonnet-different-echo",
    }));

    const { webhookData } = capturedCalls[0] as {
      webhookData: Record<string, unknown> & { result: Record<string, unknown> };
    };

    // The runner result payload must contain the echoed judge_model under result
    expect(webhookData.result.judge_model).toBe("claude-sonnet-different-echo");

    // But requestedModel and requestedJudgeModel must NOT be in the webhook payload —
    // they are stored by the route at creation time, not emitted by the runner webhook.
    // This ensures the two namespaces never collide in the merge.
    expect(webhookData.result).not.toHaveProperty("requestedModel");
    expect(webhookData.result).not.toHaveProperty("requestedJudgeModel");
    expect(webhookData).not.toHaveProperty("requestedModel");
    expect(webhookData).not.toHaveProperty("requestedJudgeModel");
  });

  test("runner webhook result keys do not include requestedModel even when model var is echoed", async () => {
    const capturedCalls: Array<{ webhookData: unknown }> = [];
    mockProcessStakworkRunWebhook.mockImplementation(async (webhookData: unknown) => {
      capturedCalls.push({ webhookData });
      return { runId: "runner-1", status: "COMPLETED", dataType: "string" };
    });

    await postWebhook(makeRunnerWithScoreRequest("runner-1", "ws-1", "valid-token"));

    const { webhookData } = capturedCalls[0] as {
      webhookData: Record<string, unknown> & { result: Record<string, unknown> };
    };
    // Confirm the runner result does not have the requestedModel namespace
    expect(webhookData.result).not.toHaveProperty("requestedModel");
    expect(webhookData.result).not.toHaveProperty("requestedJudgeModel");
  });
});
