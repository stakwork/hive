import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

// --- Stable mock references via vi.hoisted ---

const mockGetBifrostForLLM = vi.hoisted(() => vi.fn());
const mockGetApiKeyForModel = vi.hoisted(() => vi.fn());
const mockGetStakworkTokenReference = vi.hoisted(() => vi.fn());
const mockIsValidModel = vi.hoisted(() => vi.fn());

// StakworkRun DB mock helpers
const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCreate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDeleteMany = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockDbLlmModelFindMany = vi.hoisted(() => vi.fn());

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
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
      findUnique: mockDbStakworkRunFindUnique,
      create: mockDbStakworkRunCreate,
      update: mockDbStakworkRunUpdate,
      deleteMany: mockDbStakworkRunDeleteMany,
    },
    workspace: {
      findUnique: mockDbWorkspaceFindUnique,
    },
    llmModel: {
      findMany: mockDbLlmModelFindMany,
    },
    $transaction: mockDbTransaction,
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
  PUSHER_EVENTS: { STAKWORK_RUN_UPDATE: "stakwork-run-update" },
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
  isValidModel: mockIsValidModel,
  DEFAULT_BENCHMARK_MODEL: "anthropic/claude-sonnet-5",
  DEFAULT_JUDGE_MODEL: "anthropic/claude-sonnet-4-6",
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: mockGetStakworkTokenReference,
}));

import { POST as postRun } from "@/app/api/workspaces/[slug]/legal/benchmarks/run/route";
import { GET as getRun } from "@/app/api/workspaces/[slug]/legal/benchmarks/runs/[runId]/route";
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

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: "ws-1",
    swarmName: "test-swarm",
    swarmUrl: "https://swarm.example.com/api",
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
    swarmUrl: "https://swarm.example.com/api",
    swarmApiKey: "key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: null,
  },
};

const MOCK_RUNNER_RUN = {
  id: "runner-1",
  workspaceId: "ws-1",
  type: "LEGAL_BENCHMARK_RUNNER",
  status: "IN_PROGRESS",
  projectId: 42,
  result: JSON.stringify({
    taskSlug: "task-a",
    taskTitle: "Task A",
  }),
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Set up the default $transaction mock to execute the callback with a
 * minimal tx object (mirrors the actual transaction usage in run/route.ts).
 * Single-run flow: transaction creates ONE runner row only.
 */
function setupTransactionMock({
  existingActiveRun = null,
  runnerResult = { id: "runner-new" },
  throwError = null as Error | null,
} = {}) {
  mockDbTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      if (throwError) throw throwError;
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue(existingActiveRun),
          create: vi.fn().mockResolvedValue(runnerResult),
          update: vi.fn().mockResolvedValue(runnerResult),
        },
      };
      return fn(tx);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret";
  process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID = "1001";

  // Default: Jarvis configured
  mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://graph.example.com", apiKey: "supersecret" });
  mockFetchHarveyTaskCriteria.mockResolvedValue([]);
  mockEnsureHarveyLabEvalNodes.mockResolvedValue(null);
  mockAddNode.mockResolvedValue({ success: true, ref_id: "node-ref-1" });
  mockAddEdge.mockResolvedValue({ success: true });

  // Default: isValidModel always returns true (validated by DB catalog check separately)
  mockIsValidModel.mockReturnValue(true);

  // Default: DB catalog returns known Anthropic models (includes defaults)
  mockDbLlmModelFindMany.mockResolvedValue([
    { name: "claude-sonnet-5" },
    { name: "claude-sonnet-4-6" },
    { name: "claude-opus-4-6" },
    { name: "claude-haiku-4-5" },
  ]);

  // Default: Bifrost disabled → falls back to env key
  mockGetBifrostForLLM.mockResolvedValue(undefined);
  mockGetApiKeyForModel.mockReturnValue("env-anthropic-key");
  mockGetStakworkTokenReference.mockReturnValue("{{HIVE_STAGING}}");

  // Default: findUnique returns runner row (used by post-dispatch update + runs/[runId])
  mockDbStakworkRunFindUnique.mockResolvedValue(MOCK_RUNNER_RUN);
  // Default: update succeeds
  mockDbStakworkRunUpdate.mockResolvedValue(MOCK_RUNNER_RUN);
  // Default: deleteMany succeeds
  mockDbStakworkRunDeleteMany.mockResolvedValue({ count: 1 });

  // Default fetch: return non-ok for GitHub pre-fetches, ok for Stakwork dispatch.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("task.json") || String(url).includes("contents/tasks")) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      // Stakwork dispatch default
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { project_id: 99 } }),
      });
      void opts; // suppress unused warning
    }),
  );
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

    const stakworkCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      String(url).includes("/projects"),
    );
    expect(stakworkCalls).toHaveLength(0);
  });

  test("returns 409 when active run already exists for the same taskSlug", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({
      existingActiveRun: {
        id: "existing-runner",
        result: JSON.stringify({ taskSlug: "task-a" }),
      },
    });

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already in progress/i);
  });

  test("does NOT return 409 when active run is for a different taskSlug", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    // Active run for a DIFFERENT task — should not block
    setupTransactionMock({
      existingActiveRun: {
        id: "other-runner",
        result: JSON.stringify({ taskSlug: "other-task" }),
      },
    });
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
  });

  test("creates exactly one LEGAL_BENCHMARK_RUNNER row and returns run_id", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });

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
    expect(body.run_id).toBe("runner-new");
  });

  test("runner row updated to IN_PROGRESS with projectId after successful dispatch", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });

    // findUnique returns existing result so merge works
    mockDbStakworkRunFindUnique.mockResolvedValue({
      ...MOCK_RUNNER_RUN,
      id: "runner-new",
      result: JSON.stringify({ taskSlug: "task-a", taskTitle: "Task A" }),
    });

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

    // The update call should set status to IN_PROGRESS with projectId
    expect(mockDbStakworkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "runner-new" },
        data: expect.objectContaining({
          status: "IN_PROGRESS",
          projectId: 99,
        }),
      }),
    );
  });

  test("deletes single runner row and returns 502 on Stakwork dispatch failure", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-fail" } });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(502);

    // Only the single runner row should be cleaned up
    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "runner-fail" },
      }),
    );
  });

  test("top-level webhook_url sent to Stakwork uses the status hook; vars.webhook_url and persisted webhookUrl retain the response URL", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-abc" } });

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

    expect(capturedPayloads).toHaveLength(1);
    const dispatched = capturedPayloads[0] as {
      webhook_url: string;
      workflow_params: { set_var: { attributes: { vars: Record<string, string> } } };
    };

    // Top-level webhook_url must point at the lightweight status hook
    expect(dispatched.webhook_url).toMatch(/\/api\/stakwork\/webhook/);
    expect(dispatched.webhook_url).toMatch(/run_id=runner-abc/);
    expect(dispatched.webhook_url).not.toMatch(/\/api\/webhook\/stakwork\/response/);

    // vars.webhook_url must still be the run-token'd response URL
    const varsWebhookUrl = dispatched.workflow_params.set_var.attributes.vars.webhook_url;
    expect(varsWebhookUrl).toMatch(/\/api\/webhook\/stakwork\/response/);
    expect(varsWebhookUrl).toMatch(/type=LEGAL_BENCHMARK_RUNNER/);
    expect(varsWebhookUrl).toMatch(/run_id=runner-abc/);
    expect(varsWebhookUrl).toMatch(/workspace_id=ws-1/);
    expect(varsWebhookUrl).toMatch(/run_token=/);

    // The persisted StakworkRun.webhookUrl must be the response URL, not the status hook
    const persistCall = mockDbStakworkRunUpdate.mock.calls.find(
      ([args]: [{ where: { id: string }; data: { webhookUrl?: string } }]) =>
        args.where?.id === "runner-abc" && args.data?.webhookUrl !== undefined,
    );
    expect(persistCall).toBeDefined();
    const persistedUrl: string = persistCall![0].data.webhookUrl;
    expect(persistedUrl).toMatch(/\/api\/webhook\/stakwork\/response/);
    expect(persistedUrl).toMatch(/type=LEGAL_BENCHMARK_RUNNER/);
    expect(persistedUrl).toMatch(/run_id=runner-abc/);
    expect(persistedUrl).toMatch(/run_token=/);
    expect(persistedUrl).not.toMatch(/\/api\/stakwork\/webhook/);
  });

  test("swarm_url and repo2graph_url are forwarded in the dispatched Stakwork payload", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-abc" } });

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

    expect(capturedPayloads).toHaveLength(1);
    const dispatched = capturedPayloads[0] as {
      workflow_params: { set_var: { attributes: { vars: Record<string, string> } } };
    };
    const vars = dispatched.workflow_params.set_var.attributes.vars;
    const expectedAgentHost = transformSwarmUrlToRepo2Graph("https://swarm.example.com");
    expect(vars.swarm_url).toBe(expectedAgentHost);
    expect(vars.repo2graph_url).toBe(expectedAgentHost);
  });

  test("no scorer row is created — transaction creates exactly one row", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);

    let createCallCount = 0;
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(() => {
            createCallCount++;
            return Promise.resolve({ id: "runner-only" });
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

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
    // Must create exactly one row (only the runner)
    expect(createCallCount).toBe(1);
  });

  test("result JSON never contains graphSecret, apiKey as credential, or tokenReference", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);

    // Capture what's stored in result via transaction mock
    const createdRows: unknown[] = [];
    mockDbTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          stakworkRun: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation((args: { data: unknown }) => {
              createdRows.push(args.data);
              return Promise.resolve({ id: "runner-x" });
            }),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { project_id: 99 } }),
      }),
    );

    await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    // Check none of the created rows contain secrets
    for (const row of createdRows) {
      const resultStr = JSON.stringify(row);
      expect(resultStr).not.toContain("graphSecret");
      expect(resultStr).not.toContain("tokenReference");
      // swarmApiKey / supersecret (the raw API key) should not appear
      expect(resultStr).not.toContain("supersecret");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — credential pattern: swarmSecretAlias in payload
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — credential pattern: swarmSecretAlias in payload", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });
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
    expect(vars.secret).not.toBe("supersecret");
    expect(JSON.stringify(capturedPayloads[0])).not.toContain("supersecret");
    expect(vars.workspace_id).toBe("ws-1");
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
    expect(vars.workspace_id).toBe("ws-1");
  });

  test("vars.repo2graph_url is the :3355-transformed swarmUrl", async () => {
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
    expect(vars.repo2graph_url).toBe("https://swarm.example.com:3355");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — task context pre-fetch (task_goal, task_output_desc, documents)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — task context pre-fetch for Stakwork vars", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });
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
              { type: "file", name: "doc1.txt", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-a/documents/doc1.txt" },
              { type: "file", name: "doc2.txt", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-a/documents/doc2.txt" },
            ],
          });
        }
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
    expect(JSON.parse(vars.documents_json)).toEqual([
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-a/documents/doc1.txt",
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-a/documents/doc2.txt",
    ]);
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
    expect(JSON.parse(vars.documents_json)).toEqual([]);
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
              { type: "file", name: "contract.pdf", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-d/documents/contract.pdf" },
              { type: "dir", name: "subdirectory", download_url: null },
              { type: "file", name: "exhibit.docx", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-d/documents/exhibit.docx" },
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
    expect(JSON.parse(vars.documents_json)).toEqual([
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-d/documents/contract.pdf",
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-d/documents/exhibit.docx",
    ]);
  });

  test("rubrics_json contains full criteria array when criteria is present in task.json", async () => {
    const capturedPayloads: unknown[] = [];
    const mockCriteria = [
      { id: "c1", title: "Accuracy", match_criteria: "The output is accurate", deliverables: ["memo"] },
      { id: "c2", title: "Completeness", match_criteria: "All sections present" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              title: "Task E",
              instructions: "Review the contract.",
              criteria: mockCriteria,
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

    await postRun(makeRunRequest({ taskSlug: "task-e", taskTitle: "Task E" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.rubrics_json).toBe(JSON.stringify(mockCriteria));
  });

  test("rubrics_json is '[]' when task.json has no criteria field", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              title: "Task F",
              instructions: "Draft a letter.",
              // no criteria field
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

    await postRun(makeRunRequest({ taskSlug: "task-f", taskTitle: "Task F" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(vars.rubrics_json).toBe("[]");
  });

  test("documents_json excludes files with null download_url (Git LFS files)", async () => {
    const capturedPayloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (String(url).includes("task.json")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ title: "Task G", instructions: "Review.", criteria: [] }),
          });
        }
        if (String(url).includes("contents")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { type: "file", name: "normal.txt", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-g/documents/normal.txt" },
              { type: "file", name: "lfs-file.pdf", download_url: null },
              { type: "file", name: "another.txt", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-g/documents/another.txt" },
            ],
          });
        }
        capturedPayloads.push(opts?.body ? JSON.parse(opts.body as string) : null);
        return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
      }),
    );

    await postRun(makeRunRequest({ taskSlug: "task-g", taskTitle: "Task G" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const vars = (capturedPayloads[0] as { workflow_params: { set_var: { attributes: { vars: Record<string, string> } } } }).workflow_params.set_var.attributes.vars;
    expect(JSON.parse(vars.documents_json)).toEqual([
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-g/documents/normal.txt",
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/task-g/documents/another.txt",
    ]);
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

  test("returns 404 when run does not exist (findFirst returns null)", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbStakworkRunFindFirst.mockResolvedValue(null);

    const res = await getRun(makeGetRunRequest("openlaw", "nonexistent"), {
      params: Promise.resolve({ slug: "openlaw", runId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 on workspaceId mismatch — findFirst with workspaceId in WHERE returns null (IDOR guard)", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    // The route scopes workspaceId in the query itself; a foreign run returns null
    mockDbStakworkRunFindFirst.mockResolvedValue(null);

    const res = await getRun(makeGetRunRequest("openlaw", "run-other-ws"), {
      params: Promise.resolve({ slug: "openlaw", runId: "run-other-ws" }),
    });
    expect(res.status).toBe(404);
    // Confirm workspaceId was included in the findFirst call
    expect(mockDbStakworkRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
  });

  test("returns 200 with run and runnerRun alias; scorerRun is null (single-run flow)", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbStakworkRunFindFirst.mockResolvedValue(MOCK_RUNNER_RUN);

    const res = await getRun(makeGetRunRequest("openlaw", "runner-1"), {
      params: Promise.resolve({ slug: "openlaw", runId: "runner-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("runner-1");
    expect(body.runnerRun.id).toBe("runner-1");
    // scorerRun is null — no sibling in the single-run flow
    expect(body.scorerRun).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — Jarvis eval graph instrumentation (non-fatal)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — Jarvis eval graph non-fatal block", () => {
  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });
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

  test("still returns 201 when ensureHarveyLabEvalNodes returns null", async () => {
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

  test("still returns 201 when Jarvis eval block throws after dispatch", async () => {
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://j.example.com", apiKey: "key" });
    mockFetchHarveyTaskCriteria.mockRejectedValue(new Error("Jarvis criteria fetch down"));

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run_id).toBe("runner-new");
  });

  test("persists evalTriggerRef into runner result when Jarvis writes succeed", async () => {
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

    // findUnique returns existing result for merge
    mockDbStakworkRunFindUnique.mockResolvedValue({
      ...MOCK_RUNNER_RUN,
      id: "runner-new",
      result: JSON.stringify({ taskSlug: "task-a", taskTitle: "Task A" }),
    });

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);

    // evalTriggerRef should be written to runner row
    const updateCalls = mockDbStakworkRunUpdate.mock.calls;
    const evalTriggerUpdates = updateCalls.filter((call) => {
      const result = call[0]?.data?.result;
      if (!result) return false;
      try {
        return JSON.parse(result).evalTriggerRef === "trigger-ref-1";
      } catch {
        return false;
      }
    });
    expect(evalTriggerUpdates.length).toBeGreaterThanOrEqual(1);
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
    setupTransactionMock({ runnerResult: { id: "runner-new" } });
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
    expect(vars.model).toBe("claude-sonnet-5"); // new default (was claude-opus-4-5)
    expect(vars.apiKey).toBe("env-anthropic-key");
    expect(vars.baseUrl).toBe("");
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
    expect(vars).not.toHaveProperty("headers");
    expect(vars.workspace_id).toBe("ws-1");
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
    expect(vars.model).toBe("claude-sonnet-5"); // new default (was claude-opus-4-5)
    expect(vars.apiKey).toBe("env-anthropic-key");
    expect(vars.baseUrl).toBe("");
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
    expect(vars).not.toHaveProperty("headers");
    expect(vars.workspace_id).toBe("ws-1");
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
    expect(vars.model).toBe("claude-sonnet-5"); // new default (was claude-opus-4-5)
    expect(vars.apiKey).toBe("vk-test-key");
    expect(vars.baseUrl).toBe("https://bifrost.example.com/anthropic/v1");
    expect(vars.headers).toEqual({ "x-macaroon": "test-macaroon" });
    expect(vars.tokenReference).toBe("{{HIVE_STAGING}}");
    expect(vars.workspace_id).toBe("ws-1");
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
    expect(vars.workspace_id).toBe("ws-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — model & judge model selection (T1)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — model & judge model selection", () => {
  function captureStakworkVarsFromRun() {
    return new Promise<Record<string, string>>((resolve) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
          if (String(url).includes("task.json") || String(url).includes("contents")) {
            return Promise.resolve({ ok: false, status: 404 });
          }
          const payload = opts?.body ? JSON.parse(opts.body as string) : {};
          resolve(payload.workflow_params.set_var.attributes.vars);
          return Promise.resolve({ ok: true, json: async () => ({ data: { project_id: 99 } }) });
        }),
      );
    });
  }

  beforeEach(() => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    setupTransactionMock({ runnerResult: { id: "runner-new" } });
    mockDbLlmModelFindMany.mockResolvedValue([
      { name: "claude-sonnet-5" },
      { name: "claude-sonnet-4-6" },
      { name: "claude-opus-4-6" },
      { name: "claude-haiku-4-5" },
    ]);
  });

  test("omitted model defaults to claude-sonnet-5 (bare) in vars", async () => {
    const varsPromise = captureStakworkVarsFromRun();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    const vars = await varsPromise;
    expect(vars.model).toBe("claude-sonnet-5");
  });

  test("omitted judgeModel defaults to claude-sonnet-4-6 (bare) in vars", async () => {
    const varsPromise = captureStakworkVarsFromRun();
    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(201);
    const vars = await varsPromise;
    expect(vars.judge_model).toBe("claude-sonnet-4-6");
  });

  test("explicit model is stripped to bare name in vars", async () => {
    const varsPromise = captureStakworkVarsFromRun();
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "anthropic/claude-opus-4-6" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(201);
    const vars = await varsPromise;
    expect(vars.model).toBe("claude-opus-4-6");
  });

  test("explicit judgeModel is stripped to bare name in vars", async () => {
    const varsPromise = captureStakworkVarsFromRun();
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", judgeModel: "anthropic/claude-haiku-4-5" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(201);
    const vars = await varsPromise;
    expect(vars.judge_model).toBe("claude-haiku-4-5");
  });

  test("requestedModel and requestedJudgeModel are persisted in the run result at creation", async () => {
    const createdRows: Array<{ data: { result: string } }> = [];
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((args: { data: { result: string } }) => {
            createdRows.push(args);
            return Promise.resolve({ id: "runner-new" });
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    }));

    const res = await postRun(
      makeRunRequest({
        taskSlug: "task-a",
        taskTitle: "Task A",
        model: "anthropic/claude-opus-4-6",
        judgeModel: "anthropic/claude-haiku-4-5",
      }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(201);

    expect(createdRows).toHaveLength(1);
    const created = JSON.parse(createdRows[0].data.result) as Record<string, unknown>;
    expect(created.requestedModel).toBe("claude-opus-4-6");
    expect(created.requestedJudgeModel).toBe("claude-haiku-4-5");
  });

  test("requestedModel and requestedJudgeModel are bare names (no anthropic/ prefix) when persisted", async () => {
    const createdRows: Array<{ data: { result: string } }> = [];
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((args: { data: { result: string } }) => {
            createdRows.push(args);
            return Promise.resolve({ id: "runner-new" });
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    }));

    await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });

    const created = JSON.parse(createdRows[0].data.result) as Record<string, unknown>;
    // Bare names — no provider prefix
    expect(String(created.requestedModel)).not.toContain("anthropic/");
    expect(String(created.requestedJudgeModel)).not.toContain("anthropic/");
    expect(created.requestedModel).toBe("claude-sonnet-5");
    expect(created.requestedJudgeModel).toBe("claude-sonnet-4-6");
  });

  test("returns 400 when model is not Anthropic-prefixed", async () => {
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "openai/gpt-4o" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/anthropic/i);
  });

  test("returns 400 when model fails isValidModel check", async () => {
    mockIsValidModel.mockReturnValue(false);
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "invalid-model" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid model/i);
  });

  test("returns 400 when model is not found in the DB catalog", async () => {
    // isValidModel passes (has anthropic/ prefix) but DB catalog doesn't have it
    mockDbLlmModelFindMany.mockResolvedValue([{ name: "claude-sonnet-4-6" }]); // no claude-sonnet-5
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "anthropic/claude-sonnet-5" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/model catalog/i);
  });

  test("returns 400 for anthropic/typo-model not in DB catalog", async () => {
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "anthropic/claude-typo-9999" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/model catalog/i);
  });

  test("empty apiKey still dispatches — does NOT 500 (fallback preserved)", async () => {
    mockGetBifrostForLLM.mockResolvedValue(undefined);
    mockGetApiKeyForModel.mockReturnValue(undefined); // no env key either

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    }));

    const res = await postRun(makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A" }), {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    // Must NOT fail with 500 — preserves today's behavior (runner may have its own creds)
    expect(res.status).toBe(201);
  });

  test("Bifrost resolved against the chosen model (not hardcoded default)", async () => {
    mockGetBifrostForLLM.mockResolvedValue({
      apiKey: "bifrost-key-for-chosen-model",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: {},
    });

    const varsPromise = captureStakworkVarsFromRun();
    const res = await postRun(
      makeRunRequest({ taskSlug: "task-a", taskTitle: "Task A", model: "anthropic/claude-opus-4-6" }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(201);

    // Confirm Bifrost was called with the chosen model
    expect(mockGetBifrostForLLM).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ model: "anthropic/claude-opus-4-6" }),
    );

    // Confirm apiKey from Bifrost used
    const vars = await varsPromise;
    expect(vars.apiKey).toBe("bifrost-key-for-chosen-model");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — webhook clobber protection (requestedModel/requestedJudgeModel)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run — requestedModel and requestedJudgeModel survive webhook merge", () => {
  /**
   * Verifies the clobber-protection design: the runner webhook emits `judge_model`
   * (and potentially `model`) via RunnerScoreSchema, but since the operator's choices
   * are stored under `requestedModel`/`requestedJudgeModel` — keys the runner NEVER
   * emits — they survive the webhook's `{ ...existing, ...incoming }` spread untouched.
   *
   * This test exercises the route creation step to confirm both keys are stored,
   * and verifies the runner-echoed `judge_model` key is distinct from `requestedJudgeModel`.
   */
  test("requestedModel and requestedJudgeModel keys differ from runner-echoed model/judge_model keys", async () => {
    (getWorkspaceSwarmAccess as Mock).mockResolvedValue(MOCK_SWARM_ACCESS);
    const createdRows: Array<{ data: { result: string } }> = [];
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((args: { data: { result: string } }) => {
            createdRows.push(args);
            return Promise.resolve({ id: "runner-new" });
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });
    mockDbLlmModelFindMany.mockResolvedValue([
      { name: "claude-sonnet-5" },
      { name: "claude-sonnet-4-6" },
    ]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { project_id: 99 } }),
    }));

    const res = await postRun(
      makeRunRequest({
        taskSlug: "task-a",
        taskTitle: "Task A",
        model: "anthropic/claude-sonnet-5",
        judgeModel: "anthropic/claude-sonnet-4-6",
      }),
      { params: Promise.resolve({ slug: "openlaw" }) },
    );
    expect(res.status).toBe(201);

    const created = JSON.parse(createdRows[0].data.result) as Record<string, string>;
    // Operator keys stored — distinct from runner-echoed keys
    expect(created.requestedModel).toBe("claude-sonnet-5");
    expect(created.requestedJudgeModel).toBe("claude-sonnet-4-6");

    // Simulate a webhook merge spreading runner-echoed score fields on top.
    // The runner echoes judge_model (via RunnerScoreSchema) and may echo model —
    // these must NOT clobber requestedModel/requestedJudgeModel.
    const runnerEcho = {
      judge_model: "claude-sonnet-different-echo",
      model: "claude-sonnet-different-echo",
      score: 90,
      n_passed: 9,
      n_total: 10,
    };
    const mergedResult: Record<string, unknown> = { ...created, ...runnerEcho };

    // requestedModel and requestedJudgeModel are untouched since runner never emits them
    expect(mergedResult.requestedModel).toBe("claude-sonnet-5");
    expect(mergedResult.requestedJudgeModel).toBe("claude-sonnet-4-6");
    // But the runner-echoed values are present under their own separate keys
    expect(mergedResult.judge_model).toBe("claude-sonnet-different-echo");
    expect(mergedResult.model).toBe("claude-sonnet-different-echo");
  });
});

