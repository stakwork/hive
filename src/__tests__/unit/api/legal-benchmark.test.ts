import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Stable mock references via vi.hoisted ---

const mockGetBifrostForLLM = vi.hoisted(() => vi.fn());
const mockGetApiKeyForModel = vi.hoisted(() => vi.fn());
const mockGetStakworkTokenReference = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRunCreate = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRunFindUnique = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRunDelete = vi.hoisted(() => vi.fn());
const mockDbWorkspaceFindUnique = vi.hoisted(() => vi.fn());
const mockPusherTrigger = vi.hoisted(() => vi.fn());
const mockAddNode = vi.hoisted(() => vi.fn());
const mockAddEdge = vi.hoisted(() => vi.fn());
const mockGetJarvisConfig = vi.hoisted(() => vi.fn());
const mockFetchHarveyTaskCriteria = vi.hoisted(() => vi.fn());
const mockEnsureHarveyLabEvalNodes = vi.hoisted(() => vi.fn());

// --- Module mocks ---

vi.mock("@/lib/db", () => ({
  db: {
    legalBenchmarkRun: {
      create: mockDbLegalBenchmarkRunCreate,
      findFirst: mockDbLegalBenchmarkRunFindFirst,
      findUnique: mockDbLegalBenchmarkRunFindUnique,
      update: mockDbLegalBenchmarkRunUpdate,
      delete: mockDbLegalBenchmarkRunDelete,
    },
    workspace: {
      findUnique: mockDbWorkspaceFindUnique,
    },
  },
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/lib/harvey-lab/eval-nodes", () => ({
  fetchHarveyTaskCriteria: mockFetchHarveyTaskCriteria,
  ensureHarveyLabEvalNodes: mockEnsureHarveyLabEvalNodes,
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { LEGAL_BENCHMARK_UPDATE: "legal-benchmark-update" },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-stakwork-key",
  },
  isBifrostEnabledForWorkspace: () => false,
  isBifrostEnabledForAgent: () => true,
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: mockGetBifrostForLLM,
  BIFROST_AGENT_NAMES: ["plan-agent"],
}));

vi.mock("@/lib/ai/models", () => ({
  getApiKeyForModel: mockGetApiKeyForModel,
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: mockGetStakworkTokenReference,
}));

import { POST as postRun } from "@/app/api/workspaces/[slug]/legal/benchmarks/run/route";
import { GET as getRun } from "@/app/api/workspaces/[slug]/legal/benchmarks/runs/[runId]/route";
import { POST as postWebhook } from "@/app/api/legal/benchmark/webhook/route";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRunRequest(body: Record<string, unknown>, slug = "openlaw") {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/legal/benchmarks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRunRequest(slug = "openlaw", runId = "run-1") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/runs/${runId}`,
    { method: "GET" },
  );
}

function makeWebhookRequest(
  body: Record<string, unknown>,
  runId = "run-1",
  stage = "runner",
) {
  return new NextRequest(
    `http://localhost/api/legal/benchmark/webhook?run_id=${runId}&stage=${stage}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: "ws-1",
    swarmName: "test-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: "test-swarm-alias",
  },
};

const MOCK_SWARM_ACCESS_NO_ALIAS = {
  success: true,
  data: {
    workspaceId: "ws-1",
    swarmName: "test-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: null,
  },
};

const MOCK_RUN = {
  id: "run-1",
  workspaceId: "ws-1",
  taskSlug: "task-a",
  taskTitle: "Task A",
  status: "RUNNING",
  runnerProjectId: 42,
  scorerProjectId: null,
  runnerOutputUrl: null,
  runnerOutputText: null,
  scoreJson: null,
  errorMessage: null,
  evalTriggerRef: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID = "1001";
  process.env.STAKWORK_HARVEY_SCORER_WORKFLOW_ID = "1002";
  // Default: Jarvis configured so happy-path tests get correct graph_base_url/secret in payload
  mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://graph.example.com", apiKey: "supersecret" });
  mockFetchHarveyTaskCriteria.mockResolvedValue([]);
  mockEnsureHarveyLabEvalNodes.mockResolvedValue(null);
  mockAddNode.mockResolvedValue({ success: true, ref_id: "node-ref-1" });
  mockAddEdge.mockResolvedValue({ success: true });

  // Default: Bifrost disabled (returns undefined → fallback to env key)
  mockGetBifrostForLLM.mockResolvedValue(undefined);
  mockGetApiKeyForModel.mockReturnValue("env-anthropic-key");
  mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/workspaces/[slug]/legal/benchmarks/run", () => {
  test("returns 404 for non-openlaw slugs", async () => {
    const res = await postRun(makeRunRequest({ taskSlug: "a", taskTitle: "A" }, "other"), {
      params: Promise.resolve({ slug: "other" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 when taskSlug is missing", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    const res = await postRun(makeRunRequest({ taskTitle: "A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/taskSlug/i);
  });

  test("returns 400 when taskTitle is missing", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    const res = await postRun(makeRunRequest({ taskSlug: "a" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 500 when swarmSecretAlias is null", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS_NO_ALIAS);
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/swarm secret alias not configured/i);
  });

  test("returns 500 when swarmSecretAlias is empty string", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue({
      ...MOCK_SWARM_ACCESS,
      data: { ...MOCK_SWARM_ACCESS.data, swarmSecretAlias: "" },
    });
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/swarm secret alias not configured/i);
  });

  test("does NOT call Stakwork /projects when swarmSecretAlias is null", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS_NO_ALIAS);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    // fetch should never be called with the Stakwork projects endpoint
    const stakworkCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      String(url).includes("/projects"),
    );
    expect(stakworkCalls).toHaveLength(0);
  });

  test("returns 409 when active run already exists", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(MOCK_RUN);

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already in progress/i);
  });

  test("transitions PENDING → RUNNING on success", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "PENDING" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "RUNNING" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { project_id: 99 } }),
      }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run_id).toBe("run-new");

    // Verify DB update was called with RUNNING + projectId
    expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RUNNING", runnerProjectId: 99 }),
      }),
    );
  });

  test("deletes record and returns 502 on Stakwork failure", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-fail", status: "PENDING" });
    mockDbLegalBenchmarkRunDelete.mockResolvedValue({});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(502);

    // Record should be cleaned up
    expect(mockDbLegalBenchmarkRunDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-fail" } }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// POST /run — task context pre-fetch (task_goal, task_output_desc, documents)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — credential pattern: swarmSecretAlias in payload", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "PENDING" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "RUNNING" });
  });

  test("vars.secret equals swarmSecretAlias (not the decrypted apiKey)", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json") || String(url).includes("contents")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.secret).toBe("test-swarm-alias");
    expect(vars.swarm_secret_alias).toBe("test-swarm-alias");
    // Decrypted key ("supersecret") must NOT appear in the payload
    expect(vars.secret).not.toBe("supersecret");
    expect(JSON.stringify(capturedPayloads[0])).not.toContain("supersecret");
  });

  test("vars.graph_base_url is still present in the payload", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json") || String(url).includes("contents")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.graph_base_url).toBe("https://graph.example.com");
  });
});

describe("POST /run — task context pre-fetch for Stakwork vars", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "PENDING" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "RUNNING" });
  });

  test("task_output_desc uses joined deliverable keys when deliverables are present", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              title: "Task A",
              instructions: "Do this thing.",
              deliverables: { "Memo": "A memo", "Summary": "A summary" },
              criteria: [],
            }),
          });
        }
        if (String(url).includes("contents")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { type: "file", name: "doc1.txt" },
              { type: "file", name: "doc2.txt" },
            ],
          });
        }
        // Stakwork dispatch
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    expect(capturedPayloads).toHaveLength(1);
    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.task_goal).toBe("Do this thing.");
    expect(vars.task_output_desc).toBe("Memo, Summary");
    expect(JSON.parse(vars.documents)).toEqual(["doc1.txt", "doc2.txt"]);
  });

  test("task_output_desc falls back to regex parse of ### Output block when no deliverables", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              title: "Task B",
              instructions: "Analyze the contract.\n### Output:\nA written analysis",
              criteria: [],
            }),
          });
        }
        if (String(url).includes("contents")) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    await postRun(makeRunRequest({ taskSlug: "task-b", taskTitle: "Task B" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.task_output_desc).toBe("A written analysis");
  });

  test("defaults to empty strings and empty documents array when both fetches fail (non-ok), run still dispatches and returns 201", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (String(url).includes("contents")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-c", taskTitle: "Task C" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.task_goal).toBe("");
    expect(vars.task_output_desc).toBe("");
    expect(JSON.parse(vars.documents)).toEqual([]);
  });

  test("documents contains only type=file entries, excluding dirs", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              title: "Task D",
              instructions: "Read docs.",
              criteria: [],
            }),
          });
        }
        if (String(url).includes("contents")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { type: "file", name: "contract.pdf" },
              { type: "dir", name: "subdirectory" },
              { type: "file", name: "exhibit.docx" },
            ],
          });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    await postRun(makeRunRequest({ taskSlug: "task-d", taskTitle: "Task D" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(JSON.parse(vars.documents)).toEqual(["contract.pdf", "exhibit.docx"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /runs/[runId]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/workspaces/[slug]/legal/benchmarks/runs/[runId]", () => {
  test("returns 404 for non-openlaw slugs", async () => {
    const res = await getRun(makeGetRunRequest("other", "run-1"), {
      params: Promise.resolve({ slug: "other", runId: "run-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 when run does not exist", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(null);

    const res = await getRun(makeGetRunRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 on workspaceId mismatch (IDOR guard)", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue({
      ...MOCK_RUN,
      workspaceId: "ws-other", // different workspace
    });

    const res = await getRun(makeGetRunRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: "run-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 200 with run when ownership matches", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(MOCK_RUN);

    const res = await getRun(makeGetRunRequest(), {
      params: Promise.resolve({ slug: "openlaw", runId: "run-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("run-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/legal/benchmark/webhook
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/legal/benchmark/webhook", () => {
  test("returns 400 when run_id or stage are missing", async () => {
    const req = new NextRequest("http://localhost/api/legal/benchmark/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await postWebhook(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 when run_id does not match a record", async () => {
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(null);
    const res = await postWebhook(makeWebhookRequest({}, "nonexistent", "runner"));
    expect(res.status).toBe(404);
  });

  describe("stage=runner", () => {
    beforeEach(() => {
      mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(MOCK_RUN);
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "openlaw" });
      mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, status: "SCORING" });
      mockPusherTrigger.mockResolvedValue(undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: { project_id: 200 } }),
        }),
      );
    });

    test("updates status to SCORING and broadcasts Pusher event", async () => {
      const res = await postWebhook(
        makeWebhookRequest(
          { final_output: "output text", output_s3_url: "s3://bucket/key" },
          "run-1",
          "runner",
        ),
      );
      expect(res.status).toBe(200);

      // DB updated to SCORING
      expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "SCORING",
            runnerOutputText: "output text",
            runnerOutputUrl: "s3://bucket/key",
          }),
        }),
      );

      // Pusher fired
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        "workspace-openlaw",
        "legal-benchmark-update",
        expect.objectContaining({ run_id: "run-1", status: "SCORING" }),
      );
    });

    test("returns 400 when final_output is missing", async () => {
      const res = await postWebhook(
        makeWebhookRequest({ output_s3_url: "s3://bucket/key" }, "run-1", "runner"),
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 when output_s3_url is missing", async () => {
      const res = await postWebhook(
        makeWebhookRequest({ final_output: "text" }, "run-1", "runner"),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("stage=scorer", () => {
    beforeEach(() => {
      mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(MOCK_RUN);
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "openlaw" });
      mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, status: "COMPLETE" });
      mockPusherTrigger.mockResolvedValue(undefined);
    });

    test("updates status to COMPLETE and stores scoreJson", async () => {
      const scores = [
        { criterion: "Accuracy", pass: true, notes: "Good" },
        { criterion: "Clarity", pass: false, notes: "Needs work" },
      ];
      const res = await postWebhook(makeWebhookRequest({ scores }, "run-1", "scorer"));
      expect(res.status).toBe(200);

      expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "COMPLETE",
            scoreJson: JSON.stringify(scores),
          }),
        }),
      );

      expect(mockPusherTrigger).toHaveBeenCalledWith(
        "workspace-openlaw",
        "legal-benchmark-update",
        expect.objectContaining({ run_id: "run-1", status: "COMPLETE" }),
      );
    });

    test("returns 400 when scores is not an array", async () => {
      const res = await postWebhook(
        makeWebhookRequest({ scores: "not-an-array" }, "run-1", "scorer"),
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 when scores is missing", async () => {
      const res = await postWebhook(makeWebhookRequest({}, "run-1", "scorer"));
      expect(res.status).toBe(400);
    });
  });

  describe("error path", () => {
    test("sets status FAILED and broadcasts when DB update throws", async () => {
      mockDbLegalBenchmarkRunFindUnique.mockResolvedValue(MOCK_RUN);
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "openlaw" });
      // First update throws to simulate an unhandled error mid-handler
      mockDbLegalBenchmarkRunUpdate
        .mockRejectedValueOnce(new Error("DB exploded"))
        .mockResolvedValue({ ...MOCK_RUN, status: "FAILED" });
      mockPusherTrigger.mockResolvedValue(undefined);

      const res = await postWebhook(
        makeWebhookRequest(
          { final_output: "out", output_s3_url: "s3://b/k" },
          "run-1",
          "runner",
        ),
      );
      expect(res.status).toBe(500);

      // FAILED state persisted
      expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            errorMessage: "DB exploded",
          }),
        }),
      );

      // FAILED broadcast fired
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        "workspace-openlaw",
        "legal-benchmark-update",
        expect.objectContaining({ status: "FAILED" }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — Jarvis eval graph instrumentation (non-fatal)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — Jarvis eval graph non-fatal block", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "PENDING" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "RUNNING" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { project_id: 99 } }),
      }),
    );
  });

  test("returns 500 when getJarvisConfigForWorkspace returns null", async () => {
    mockGetJarvisConfig.mockResolvedValue(null);

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/swarm not configured/i);
  });

  test("still returns 201 + RUNNING when ensureHarveyLabEvalNodes returns null", async () => {
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://j.example.com", apiKey: "key" });
    mockFetchHarveyTaskCriteria.mockResolvedValue(["criterion A"]);
    mockEnsureHarveyLabEvalNodes.mockResolvedValue(null);

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    // EvalTrigger addNode should not be called if evalNodes is null
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  test("still returns 201 + RUNNING when Jarvis eval block throws after dispatch", async () => {
    // getJarvisConfigForWorkspace succeeds (needed for payload), but ensureHarveyLabEvalNodes throws
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://j.example.com", apiKey: "key" });
    mockFetchHarveyTaskCriteria.mockRejectedValue(new Error("Jarvis criteria fetch down"));

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run_id).toBe("run-new");
  });

  test("persists evalTriggerRef when Jarvis writes succeed", async () => {
    const JARVIS_CONFIG = { jarvisUrl: "https://j.example.com", apiKey: "key" };
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockFetchHarveyTaskCriteria.mockResolvedValue(["criterion A"]);
    mockEnsureHarveyLabEvalNodes.mockResolvedValue({
      evalSetRef: "evalset-ref",
      requirementRef: "req-ref",
    });
    // EvalTrigger addNode, HiveAgent addNode
    mockAddNode
      .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" })  // EvalTrigger
      .mockResolvedValueOnce({ success: true, ref_id: "agent-ref-1" });   // HiveAgent
    mockAddEdge.mockResolvedValue({ success: true });

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    // evalTriggerRef should be persisted
    expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ evalTriggerRef: "trigger-ref-1" }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook stage=scorer — Jarvis EvalTriggerOutput (non-fatal)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /webhook stage=scorer — Jarvis EvalTriggerOutput non-fatal block", () => {
  const SCORES = [
    { criterion: "Accuracy", pass: true, notes: "Well done" },
    { criterion: "Clarity", pass: false, notes: "Needs improvement" },
  ];

  beforeEach(() => {
    mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "openlaw" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, status: "COMPLETE" });
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  test("returns 200 + COMPLETE when evalTriggerRef is null (no Jarvis calls)", async () => {
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue({ ...MOCK_RUN, evalTriggerRef: null });

    const res = await postWebhook(makeWebhookRequest({ scores: SCORES }, "run-1", "scorer"));
    expect(res.status).toBe(200);
    expect(mockGetJarvisConfig).not.toHaveBeenCalled();
    expect(mockAddNode).not.toHaveBeenCalled();
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("returns 200 + COMPLETE when evalTriggerRef is set and Jarvis succeeds", async () => {
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue({
      ...MOCK_RUN,
      evalTriggerRef: "trigger-ref-1",
    });
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://j.example.com", apiKey: "key" });
    mockAddNode.mockResolvedValue({ success: true, ref_id: "output-ref" });
    mockAddEdge.mockResolvedValue({ success: true });

    const res = await postWebhook(makeWebhookRequest({ scores: SCORES }, "run-1", "scorer"));
    expect(res.status).toBe(200);

    // One EvalTriggerOutput per score entry
    expect(mockAddNode).toHaveBeenCalledTimes(SCORES.length);
    expect(mockAddEdge).toHaveBeenCalledTimes(SCORES.length);

    // Verify first output node shape
    expect(mockAddNode).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        node_type: "EvalTriggerOutput",
        node_data: expect.objectContaining({
          result: "pass",
          score: 1.0,
          attempt_number: 1,
          judge_notes: "Accuracy: Well done",
        }),
      }),
    );

    // Verify HAS_OUTPUT edge wired to evalTriggerRef
    expect(mockAddEdge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        edge: { edge_type: "HAS_OUTPUT" },
        source: { ref_id: "trigger-ref-1" },
        target: { ref_id: "output-ref" },
      }),
    );

    // Run should be COMPLETE
    expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETE" }),
      }),
    );
  });

  test("returns 200 + COMPLETE even when Jarvis EvalTriggerOutput writes throw", async () => {
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue({
      ...MOCK_RUN,
      evalTriggerRef: "trigger-ref-1",
    });
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://j.example.com", apiKey: "key" });
    mockAddNode.mockRejectedValue(new Error("Jarvis unavailable"));

    const res = await postWebhook(makeWebhookRequest({ scores: SCORES }, "run-1", "scorer"));
    expect(res.status).toBe(200);

    // Run status must still be COMPLETE
    expect(mockDbLegalBenchmarkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETE" }),
      }),
    );

    // Pusher broadcast must still fire
    expect(mockPusherTrigger).toHaveBeenCalledWith(
      "workspace-openlaw",
      "legal-benchmark-update",
      expect.objectContaining({ status: "COMPLETE" }),
    );
  });

  test("returns 200 + COMPLETE when getJarvisConfigForWorkspace returns null", async () => {
    mockDbLegalBenchmarkRunFindUnique.mockResolvedValue({
      ...MOCK_RUN,
      evalTriggerRef: "trigger-ref-1",
    });
    mockGetJarvisConfig.mockResolvedValue(null);

    const res = await postWebhook(makeWebhookRequest({ scores: SCORES }, "run-1", "scorer"));
    expect(res.status).toBe(200);
    expect(mockAddNode).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — Bifrost LLM credential vars
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — Bifrost LLM credential vars in Stakwork payload", () => {
  function captureStakworkVars(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
          if (String(url).includes("task.json")) {
            return Promise.resolve({ ok: false, status: 404 });
          }
          if (String(url).includes("contents")) {
            return Promise.resolve({ ok: false, status: 404 });
          }
          // Stakwork dispatch — capture payload
          const payload = opts?.body ? JSON.parse(opts.body as string) : {};
          resolve(payload.workflow_params.set_var.attributes.vars);
          return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
        }),
      );
    });
  }

  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbLegalBenchmarkRunFindFirst.mockResolvedValue(null);
    mockDbLegalBenchmarkRunCreate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "PENDING" });
    mockDbLegalBenchmarkRunUpdate.mockResolvedValue({ ...MOCK_RUN, id: "run-new", status: "RUNNING" });
  });

  test("getBifrostForLLM throws → route still dispatches with env apiKey and tokenReference present", async () => {
    mockGetBifrostForLLM.mockRejectedValue(new Error("Bifrost unavailable"));
    mockGetApiKeyForModel.mockReturnValue("env-anthropic-key");
    mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");

    const varsPromise = captureStakworkVars();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = await varsPromise;
    expect(vars.model).toBe("claude-opus-4-5");
    expect(vars.apiKey).toBe("env-anthropic-key");
    expect(vars.baseUrl).toBe("");
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
    expect(vars).not.toHaveProperty("headers");
  });

  test("getBifrostForLLM returns undefined → same fallback: env apiKey, empty baseUrl, tokenReference present", async () => {
    mockGetBifrostForLLM.mockResolvedValue(undefined);
    mockGetApiKeyForModel.mockReturnValue("env-anthropic-key");
    mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");

    const varsPromise = captureStakworkVars();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = await varsPromise;
    expect(vars.model).toBe("claude-opus-4-5");
    expect(vars.apiKey).toBe("env-anthropic-key");
    expect(vars.baseUrl).toBe("");
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
    expect(vars).not.toHaveProperty("headers");
  });

  test("getBifrostForLLM returns full credentials with non-empty headers → headers appears in vars", async () => {
    mockGetBifrostForLLM.mockResolvedValue({
      apiKey: "vk-test-key",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: { "x-macaroon": "test-macaroon" },
    });
    mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");

    const varsPromise = captureStakworkVars();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = await varsPromise;
    expect(vars.model).toBe("claude-opus-4-5");
    expect(vars.apiKey).toBe("vk-test-key");
    expect(vars.baseUrl).toBe("https://bifrost.example.com/anthropic/v1");
    expect(vars.headers).toEqual({ "x-macaroon": "test-macaroon" });
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
  });

  test("getBifrostForLLM returns credentials with empty headers → headers omitted from vars", async () => {
    mockGetBifrostForLLM.mockResolvedValue({
      apiKey: "vk-test-key",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: {},
    });
    mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");

    const varsPromise = captureStakworkVars();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    const vars = await varsPromise;
    expect(vars.apiKey).toBe("vk-test-key");
    expect(vars.baseUrl).toBe("https://bifrost.example.com/anthropic/v1");
    expect(vars).not.toHaveProperty("headers");
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
  });
});
