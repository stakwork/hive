/**
 * Unit tests for:
 *  1. POST /api/workspaces/[slug]/legal/benchmarks/runs/[runId]/eval  (route tests 1–6)
 *  2. processLegalBenchmarkEvalWebhook service logic (webhook tests 7–9)
 *
 * 9 test cases per spec:
 *  1. All verdicts "pass" → { skipped: true, reason: "no_failures" } 200
 *  2. Criterion already has cause_type → { skipped: true, reason: "already_ran" } 200
 *  3. Active eval run for same sourceRunId → 409 ACTIVE_EVAL_RUN_EXISTS
 *  4. Dispatches to Stakwork with correct workflow_params shape
 *  5. Stakwork non-ok → deleteMany called, route returns 502
 *  6. Success → 201 { evalRunId }
 *  7. causes[] annotated onto source run's criteria_results — matched by criterion_id, unmatched unchanged
 *  8. Pusher fires with runId === sourceRunId (not eval run id)
 *  9. sourceRunId missing from payload → no throw, no source run update
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCreate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdateMany = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDeleteMany = vi.hoisted(() => vi.fn());
const mockPusherTrigger = vi.hoisted(() => vi.fn());
const mockGetJarvisConfig = vi.hoisted(() => vi.fn());
const mockAddNode = vi.hoisted(() => vi.fn());
const mockAddEdge = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
      findUnique: mockDbStakworkRunFindUnique,
      create: mockDbStakworkRunCreate,
      update: mockDbStakworkRunUpdate,
      updateMany: mockDbStakworkRunUpdateMany,
      deleteMany: mockDbStakworkRunDeleteMany,
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
}));

vi.mock("@/config/env", () => ({
  config: {
    USE_MOCKS: false,
    MOCK_BASE: "",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-key",
    STAKWORK_HARVEY_EVAL_WORKFLOW_ID: "2002",
  },
}));

// ─── Import subjects under test ───────────────────────────────────────────────

import { POST as postEval } from "@/app/api/workspaces/[slug]/legal/benchmarks/runs/[runId]/eval/route";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { WorkflowStatus } from "@prisma/client";

// ─── Shared fixture data ──────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-1";
const SOURCE_RUN_ID = "runner-run-1";
const EVAL_RUN_ID = "eval-run-1";

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: WORKSPACE_ID,
    swarmName: "test-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: "test-swarm-alias",
  },
};

/** A runner run with one pass + one fail criterion */
function makeRunnerRun(resultOverrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    type: "LEGAL_BENCHMARK_RUNNER",
    status: "COMPLETED",
    projectId: 42,
    result: JSON.stringify({
      taskSlug: "contracts/nda",
      taskTitle: "NDA Review",
      evalTriggerRef: "eval-trigger-ref-1",
      score: 1,
      max_score: 2,
      n_passed: 1,
      n_total: 2,
      judge_model: "gpt-4o",
      criteria_results: [
        { id: "c1", title: "Criterion 1", verdict: "pass", reasoning: "Good" },
        { id: "c2", title: "Criterion 2", verdict: "fail", reasoning: "Missing clause" },
      ],
      ...resultOverrides,
    }),
    agentLogs: [],
  };
}

function makeEvalRequest(runId = SOURCE_RUN_ID, slug = "openlaw") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/runs/${runId}/eval`,
    { method: "POST" },
  );
}

/** Build the HMAC run_token for a given runId using the test secret */
function makeRunToken(runId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("crypto") as typeof import("crypto");
  return createHmac("sha256", "test-secret").update(runId).digest("hex");
}

// ─── Default happy-path setup helpers ────────────────────────────────────────

function setupDefaultRouteMocks() {
  (getWorkspaceSwarmAccess as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_SWARM_ACCESS);
  mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://graph.example.com", apiKey: "sec" });

  // Source run: one failed criterion, no active eval run
  mockDbStakworkRunFindUnique.mockResolvedValue(makeRunnerRun());
  mockDbStakworkRunFindFirst.mockResolvedValue(null);

  // Create / update / delete succeed
  mockDbStakworkRunCreate.mockResolvedValue({ id: EVAL_RUN_ID });
  mockDbStakworkRunUpdate.mockResolvedValue({ id: EVAL_RUN_ID, result: "{}" });
  mockDbStakworkRunUpdateMany.mockResolvedValue({ count: 1 });
  mockDbStakworkRunDeleteMany.mockResolvedValue({ count: 1 });
  mockPusherTrigger.mockResolvedValue(undefined);

  // Default Stakwork fetch → success
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Route tests (1–6)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/workspaces/[slug]/legal/benchmarks/runs/[runId]/eval", () => {
  beforeEach(() => {
    vi.resetAllMocks(); // clear implementations AND call history
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.NEXTAUTH_SECRET = "test-secret";
    setupDefaultRouteMocks();
  });

  // Test 1: All verdicts "pass" → skip
  test("1. returns 200 { skipped, reason: no_failures } when all criteria pass", async () => {
    mockDbStakworkRunFindUnique.mockResolvedValue(
      makeRunnerRun({
        criteria_results: [
          { id: "c1", title: "C1", verdict: "pass", reasoning: "ok" },
          { id: "c2", title: "C2", verdict: "Pass", reasoning: "ok" },
        ],
      }),
    );

    const res = await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ skipped: true, reason: "no_failures" });
  });

  // Test 2: Already ran (cause_type present) → skip
  test("2. returns 200 { skipped, reason: already_ran } when a failed criterion already has cause_type", async () => {
    mockDbStakworkRunFindUnique.mockResolvedValue(
      makeRunnerRun({
        criteria_results: [
          { id: "c1", title: "C1", verdict: "pass", reasoning: "ok" },
          {
            id: "c2",
            title: "C2",
            verdict: "fail",
            reasoning: "Missing",
            cause_type: "missing_logic",
          },
        ],
      }),
    );

    const res = await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ skipped: true, reason: "already_ran" });
  });

  // Test 3: Active eval run for same sourceRunId → 409
  test("3. returns 409 ACTIVE_EVAL_RUN_EXISTS when active eval run exists for this source run", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue({
      id: "existing-eval-run",
      result: JSON.stringify({ sourceRunId: SOURCE_RUN_ID }),
    });

    const res = await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ACTIVE_EVAL_RUN_EXISTS");
  });

  // Test 4: Dispatches correct workflow_params to Stakwork
  test("4. dispatches correct workflow_params shape to Stakwork", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects");

    const payload = JSON.parse(options.body as string) as {
      workflow_id: number;
      workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
    };
    const vars = payload.workflow_params.set_var.attributes.vars;

    expect(vars).toHaveProperty("source_run_id", SOURCE_RUN_ID);
    expect(vars).toHaveProperty("task_slug", "contracts/nda");
    expect(vars).toHaveProperty("failed_criteria_json");
    expect(vars).toHaveProperty("agent_logs_json");
    expect(vars).toHaveProperty("webhook_url");
    expect(vars).toHaveProperty("swarm_secret_alias");
    expect(vars).toHaveProperty("workspace_id", WORKSPACE_ID);

    // failed_criteria_json should contain only the failed criterion (backwards compat)
    const failedCriteria = JSON.parse(vars.failed_criteria_json as string) as Array<{ id: string }>;
    expect(failedCriteria).toHaveLength(1);
    expect(failedCriteria[0].id).toBe("c2");

    // full_result_json must be present and contain ALL criteria (pass + fail)
    expect(vars).toHaveProperty("full_result_json");
    const fullResult = JSON.parse(vars.full_result_json as string) as {
      criteria_results: Array<{ id: string }>;
      score: number;
      max_score: number;
      n_passed: number;
      n_total: number;
      judge_model: string;
    };
    expect(fullResult.criteria_results).toHaveLength(2);
    expect(fullResult.criteria_results.map((c) => c.id)).toEqual(
      expect.arrayContaining(["c1", "c2"]),
    );
    // Aggregate score fields must be present and match fixture values
    expect(fullResult.score).toBe(1);
    expect(fullResult.max_score).toBe(2);
    expect(fullResult.n_passed).toBe(1);
    expect(fullResult.n_total).toBe(2);
    expect(fullResult.judge_model).toBe("gpt-4o");

    // No discrete score vars (single-blob contract)
    expect(vars).not.toHaveProperty("score");
    expect(vars).not.toHaveProperty("max_score");
    expect(vars).not.toHaveProperty("n_total");
    expect(vars).not.toHaveProperty("n_passed");
    expect(vars).not.toHaveProperty("judge_model");

    expect(payload.workflow_id).toBe(2002);
  });

  // Test 5: Stakwork non-ok → deleteMany + 502
  test("5. returns 502 and calls deleteMany when Stakwork dispatch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const res = await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(res.status).toBe(502);
    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith({
      where: { id: EVAL_RUN_ID },
    });
  });

  // Test 6: Success → 201 { evalRunId }
  test("6. returns 201 with evalRunId on success", async () => {
    const res = await postEval(makeEvalRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: SOURCE_RUN_ID }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("evalRunId", EVAL_RUN_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook service tests (processLegalBenchmarkEvalWebhook) — tests 7–9
// Drive via processStakworkRunWebhook directly
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal eval run fixture matching what processStakworkRunWebhook expects */
function makeEvalRunForWebhook(resultOverrides: Record<string, unknown> = {}) {
  return {
    id: EVAL_RUN_ID,
    workspaceId: WORKSPACE_ID,
    type: "LEGAL_BENCHMARK_EVAL",
    status: WorkflowStatus.IN_PROGRESS,
    projectId: 99,
    featureId: null,
    promptVersionId: null,
    result: JSON.stringify({
      sourceRunId: SOURCE_RUN_ID,
      taskSlug: "contracts/nda",
      failedCriteriaCount: 1,
      evalTriggerRef: "eval-trigger-ref-1",
      projectId: 99,
      ...resultOverrides,
    }),
    workspace: {
      slug: "openlaw",
      ownerId: "u1",
      sphinxEnabled: false,
      sphinxChatPubkey: null,
      sphinxBotId: null,
      sphinxBotSecret: null,
    },
    feature: null,
  };
}

/** Source runner run for webhook annotation tests */
function makeSourceRunForWebhook() {
  return {
    id: SOURCE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    result: JSON.stringify({
      taskSlug: "contracts/nda",
      taskTitle: "NDA Review",
      criteria_results: [
        { id: "c1", title: "Criterion 1", verdict: "pass", reasoning: "Good" },
        { id: "c2", title: "Criterion 2", verdict: "fail", reasoning: "Missing clause" },
      ],
    }),
  };
}

describe("processLegalBenchmarkEvalWebhook (via processStakworkRunWebhook)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";

    mockPusherTrigger.mockResolvedValue(undefined);
    mockDbStakworkRunUpdate.mockResolvedValue({});
    mockDbStakworkRunUpdateMany.mockResolvedValue({ count: 1 });
    mockDbStakworkRunDeleteMany.mockResolvedValue({ count: 1 });
  });

  // Test 7: causes[] annotated onto source run's criteria_results
  test("7. annotates cause fields onto matching source run criteria_results; unmatched criteria unchanged", async () => {
    // findFirst → resolve eval run by id in processStakworkRunWebhook
    mockDbStakworkRunFindFirst.mockResolvedValue(makeEvalRunForWebhook());

    // findUnique → called by processLegalBenchmarkEvalWebhook for source run
    mockDbStakworkRunFindUnique.mockResolvedValue(makeSourceRunForWebhook());

    const causes = [
      {
        criterion_id: "c2",
        cause_type: "missing_logic",
        cause_summary: "NDA missing governing law clause",
        cause_detail: "Section 5 is absent",
        suggested_fix: "Add governing law section",
        log_evidence: "line 42",
        cause_ref_id: "ref-abc",
      },
    ];

    await processStakworkRunWebhook(
      { result: { causes, sourceRunId: SOURCE_RUN_ID }, project_status: "complete" },
      {
        type: "LEGAL_BENCHMARK_EVAL",
        workspace_id: WORKSPACE_ID,
        run_id: EVAL_RUN_ID,
        run_token: makeRunToken(EVAL_RUN_ID),
      },
    );

    // Find the update call targeting the SOURCE run
    const sourceUpdateCall = (
      mockDbStakworkRunUpdate.mock.calls as Array<[{ where: { id: string }; data: { result: string } }]>
    ).find((call) => call[0].where?.id === SOURCE_RUN_ID);

    expect(sourceUpdateCall).toBeDefined();

    const updatedResult = JSON.parse(sourceUpdateCall![0].data.result) as {
      criteria_results: Array<Record<string, unknown>>;
    };

    // c2 should be annotated with cause fields
    const c2 = updatedResult.criteria_results.find((c) => c.id === "c2") as Record<string, unknown> | undefined;
    expect(c2).toBeDefined();
    expect(c2!.cause_type).toBe("missing_logic");
    expect(c2!.cause_summary).toBe("NDA missing governing law clause");
    expect(c2!.cause_detail).toBe("Section 5 is absent");
    expect(c2!.suggested_fix).toBe("Add governing law section");

    // c2 must also retain its pre-existing fields (no clobber)
    expect(c2!.verdict).toBe("fail");
    expect(c2!.title).toBe("Criterion 2");
    expect(c2!.reasoning).toBe("Missing clause");

    // c1 should be fully untouched — no cause fields added, existing fields preserved
    const c1 = updatedResult.criteria_results.find((c) => c.id === "c1") as Record<string, unknown> | undefined;
    expect(c1).toBeDefined();
    expect(c1!.cause_type).toBeUndefined();
    expect(c1!.cause_summary).toBeUndefined();
    expect(c1!.cause_detail).toBeUndefined();
    expect(c1!.suggested_fix).toBeUndefined();
    // Pre-existing fields on c1 must be intact
    expect(c1!.verdict).toBe("pass");
    expect(c1!.title).toBe("Criterion 1");
    expect(c1!.reasoning).toBe("Good");
    // Exactly the fields from the source fixture — no new keys
    expect(Object.keys(c1!)).toEqual(["id", "title", "verdict", "reasoning"]);
  });

  // Test 8: Pusher fires with runId === sourceRunId (not eval run id)
  test("8. Pusher fires with runId === sourceRunId (not eval run id)", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(makeEvalRunForWebhook());
    mockDbStakworkRunFindUnique.mockResolvedValue(makeSourceRunForWebhook());

    const causes = [
      {
        criterion_id: "c2",
        cause_type: "missing_logic",
        cause_summary: "Missing clause",
      },
    ];

    await processStakworkRunWebhook(
      { result: { causes, sourceRunId: SOURCE_RUN_ID }, project_status: "complete" },
      {
        type: "LEGAL_BENCHMARK_EVAL",
        workspace_id: WORKSPACE_ID,
        run_id: EVAL_RUN_ID,
        run_token: makeRunToken(EVAL_RUN_ID),
      },
    );

    // Pusher should have been called at least twice:
    // once for sourceRunId and once for the eval run itself
    const pusherCalls = mockPusherTrigger.mock.calls as Array<
      [string, string, { runId: string }]
    >;

    const sourceRunCall = pusherCalls.find((c) => c[2]?.runId === SOURCE_RUN_ID);
    expect(sourceRunCall).toBeDefined();
    expect(sourceRunCall![2].runId).toBe(SOURCE_RUN_ID);

    const evalRunCall = pusherCalls.find((c) => c[2]?.runId === EVAL_RUN_ID);
    expect(evalRunCall).toBeDefined();
    expect(evalRunCall![2].runId).toBe(EVAL_RUN_ID);
  });

  // Test 9: sourceRunId missing → no throw, no source run update
  test("9. sourceRunId missing from payload → no throw, no source run update", async () => {
    const evalRunNoSource = makeEvalRunForWebhook({
      // sourceRunId intentionally omitted
    });
    // Override result to remove sourceRunId
    evalRunNoSource.result = JSON.stringify({
      taskSlug: "contracts/nda",
      failedCriteriaCount: 1,
    });

    mockDbStakworkRunFindFirst.mockResolvedValue(evalRunNoSource);

    const causes = [
      { criterion_id: "c2", cause_type: "missing_logic", cause_summary: "Missing clause" },
    ];

    // Should NOT throw
    await expect(
      processStakworkRunWebhook(
        { result: { causes }, project_status: "complete" },
        {
          type: "LEGAL_BENCHMARK_EVAL",
          workspace_id: WORKSPACE_ID,
          run_id: EVAL_RUN_ID,
          run_token: makeRunToken(EVAL_RUN_ID),
        },
      ),
    ).resolves.not.toThrow();

    // Should NOT have called update on the source run
    const sourceUpdateCall = (
      mockDbStakworkRunUpdate.mock.calls as Array<[{ where: { id: string } }]>
    ).find((call) => call[0].where?.id === SOURCE_RUN_ID);

    expect(sourceUpdateCall).toBeUndefined();
  });

  // Test 10: Full judge payload + correlation survival on eval run, and zero graph writes
  test("10. full judge payload + correlation survival on eval run; zero graph writes", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(makeEvalRunForWebhook());
    mockDbStakworkRunFindUnique.mockResolvedValue(makeSourceRunForWebhook());

    const judgePayload = {
      sourceRunId: SOURCE_RUN_ID,
      taskSlug: "contracts/nda",
      score: 1,
      max_score: 2,
      all_pass: false,
      n_passed: 1,
      n_total: 2,
      pass_rate: 0.5,
      judge_model: "gpt-4o",
      criteria_results: [
        { id: "c1", verdict: "pass", title: "C1", reasoning: "ok" },
        { id: "c2", verdict: "fail", title: "C2", reasoning: "missing", cause_type: "missing_logic" },
      ],
      candidate_files: ["file-a.pdf"],
      verify_pass_results: [{ check: "format", passed: true }],
      causes: [],
    };

    await processStakworkRunWebhook(
      { result: judgePayload, project_status: "complete" },
      {
        type: "LEGAL_BENCHMARK_EVAL",
        workspace_id: WORKSPACE_ID,
        run_id: EVAL_RUN_ID,
        run_token: makeRunToken(EVAL_RUN_ID),
      },
    );

    // The eval run is written twice: once via updateMany (generic merge) and once via
    // the handler's update (adding processedAt). Find the LAST update call targeting EVAL_RUN_ID.
    const evalUpdateCalls = (
      mockDbStakworkRunUpdate.mock.calls as Array<[{ where: { id: string }; data: { result: string } }]>
    ).filter((call) => call[0].where?.id === EVAL_RUN_ID);

    // There should be at least one update call on the eval run (the handler's processedAt write)
    expect(evalUpdateCalls.length).toBeGreaterThan(0);

    // Assert against the last eval-run update (the handler's own write)
    const lastEvalUpdate = evalUpdateCalls[evalUpdateCalls.length - 1];
    const persistedResult = JSON.parse(lastEvalUpdate[0].data.result) as Record<string, unknown>;

    // Judge/rubric fields must be present with correct values
    expect(persistedResult.score).toBe(1);
    expect(persistedResult.max_score).toBe(2);
    expect(persistedResult.all_pass).toBe(false);
    expect(persistedResult.n_passed).toBe(1);
    expect(persistedResult.n_total).toBe(2);
    expect(persistedResult.pass_rate).toBe(0.5);
    expect(persistedResult.judge_model).toBe("gpt-4o");
    expect(persistedResult.criteria_results).toEqual(judgePayload.criteria_results);
    expect(persistedResult.candidate_files).toEqual(["file-a.pdf"]);
    expect(persistedResult.verify_pass_results).toEqual([{ check: "format", passed: true }]);

    // Pre-existing correlation fields must survive the merge intact
    expect(persistedResult.sourceRunId).toBe(SOURCE_RUN_ID);
    expect(persistedResult.taskSlug).toBe("contracts/nda");
    expect(persistedResult.evalTriggerRef).toBe("eval-trigger-ref-1");
    expect(persistedResult.projectId).toBe(99);

    // Zero graph writes — the EVAL path must never call addNode or addEdge
    expect(mockAddNode).not.toHaveBeenCalled();
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  // Test 11: Non-fatal on malformed source-run criteria_results (non-array)
  test("11. non-fatal when source run criteria_results is not an array — eval run still persisted", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(makeEvalRunForWebhook());

    // Source run with malformed criteria_results (string instead of array)
    mockDbStakworkRunFindUnique.mockResolvedValue({
      id: SOURCE_RUN_ID,
      workspaceId: WORKSPACE_ID,
      result: JSON.stringify({
        taskSlug: "contracts/nda",
        criteria_results: "not-an-array",
      }),
    });

    const causes = [
      { criterion_id: "c2", cause_type: "missing_logic", cause_summary: "Missing clause" },
    ];

    // Must resolve without throwing
    await expect(
      processStakworkRunWebhook(
        { result: { causes, sourceRunId: SOURCE_RUN_ID }, project_status: "complete" },
        {
          type: "LEGAL_BENCHMARK_EVAL",
          workspace_id: WORKSPACE_ID,
          run_id: EVAL_RUN_ID,
          run_token: makeRunToken(EVAL_RUN_ID),
        },
      ),
    ).resolves.not.toThrow();

    // Eval run must still have been persisted (at minimum the handler's processedAt update)
    const evalUpdateCalls = (
      mockDbStakworkRunUpdate.mock.calls as Array<[{ where: { id: string } }]>
    ).filter((call) => call[0].where?.id === EVAL_RUN_ID);

    expect(evalUpdateCalls.length).toBeGreaterThan(0);

    // Also accept a generic updateMany covering the eval run (generic merge path)
    const evalUpdateManyCalls = (
      mockDbStakworkRunUpdateMany.mock.calls as Array<[{ where: { id: string } }]>
    ).filter((call) => call[0].where?.id === EVAL_RUN_ID);

    // At least one of the two write paths must have fired for the eval run
    expect(evalUpdateCalls.length + evalUpdateManyCalls.length).toBeGreaterThan(0);
  });
});
