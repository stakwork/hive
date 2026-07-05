/**
 * Integration tests for prompt usage/run-count enrichment via local mirror tables.
 *
 * Covers:
 *  - GET /api/workflow/prompts?include_usages=true  (list route)
 *  - GET /api/workflow/prompts/[id]/versions        (versions list route)
 *  - GET /api/workflow/prompts/[id]/versions/[versionId] (single-version route)
 *
 * All routes now read from PromptUsage / PromptDailyRun local tables instead of
 * making live Stakwork API calls.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import {
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-key-usages",
    WORKFLOW_GRAPH_PROMPT_STORAGE_ID: "",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));

const mockStakworkRequest = vi.fn().mockResolvedValue({ id: 1 });
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({ stakworkRequest: mockStakworkRequest })),
}));

import { isDevelopmentMode } from "@/lib/runtime";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Mock Stakwork create response (needed for POST /prompts which still calls Stakwork) */
function stakworkOkCreate(id = 99) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { id } }),
  } as Response);
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

interface SharedState {
  testUser: { id: string; email: string | null };
  stakworkWorkspace: { id: string; slug: string };
  createdPromptIds: string[];
}

async function setupSharedState(): Promise<SharedState> {
  const testUser = await createTestUser();
  const stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
    create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
    update: {},
  });
  return { testUser, stakworkWorkspace, createdPromptIds: [] };
}

// ─── GET /api/workflow/prompts?include_usages=true ────────────────────────────

describe("GET /api/workflow/prompts?include_usages=true", () => {
  let state: SharedState;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
    mockIsDevelopmentMode.mockReturnValue(false);
    state = await setupSharedState();
  });

  afterEach(async () => {
    if (state.createdPromptIds.length > 0) {
      await db.prompt.deleteMany({ where: { id: { in: state.createdPromptIds } } });
      state.createdPromptIds.length = 0;
    }
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string, value = "test value") {
    mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(state.testUser));
    stakworkOkCreate();
    const req = makeReq("http://localhost/api/workflow/prompts", "POST", { name, value });
    const res = await POST(req);
    const body = await res.json();
    state.createdPromptIds.push(body.data.id);
    return body.data as { id: string; name: string; current_version_id: string };
  }

  async function seedPromptUsage(
    promptId: string,
    promptName: string,
    workflowId: number,
    stepId: string,
    workflowName?: string,
  ) {
    return db.promptUsage.create({
      data: {
        workspaceId: state.stakworkWorkspace.id,
        promptId,
        promptName,
        workflowId,
        workflowName: workflowName ?? null,
        stepId,
      },
    });
  }

  async function seedPromptDailyRun(promptId: string, versionId: string | null, runCount: number) {
    return db.promptDailyRun.create({
      data: {
        promptId,
        versionId,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-01"),
        runCount,
        hiveVersionId: versionId ?? "unknown",
      },
    });
  }

  test("returns usages from PromptUsage table", async () => {
    const prompt = await createPrompt("USAGES_TEST_PROMPT");
    await seedPromptUsage(prompt.id, "USAGES_TEST_PROMPT", 101, "step_1", "Flow A");
    await seedPromptUsage(prompt.id, "USAGES_TEST_PROMPT", 102, "step_2", "Flow B");

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.prompts.find((p: { name: string }) => p.name === "USAGES_TEST_PROMPT");
    expect(found).toBeTruthy();
    expect(found.usages).toHaveLength(2);
    expect(found.usages).toEqual(
      expect.arrayContaining([
        { workflow_id: 101, workflow_name: "Flow A", step_id: "step_1" },
        { workflow_id: 102, workflow_name: "Flow B", step_id: "step_2" },
      ]),
    );
  });

  test("deduplicates usages by (workflow_id, step_id)", async () => {
    const prompt = await createPrompt("DEDUP_TEST_PROMPT");
    // Two rows with the same workflowId+stepId (different workspace rows)
    await db.promptUsage.create({
      data: {
        workspaceId: state.stakworkWorkspace.id,
        promptId: prompt.id,
        promptName: "DEDUP_TEST_PROMPT",
        workflowId: 10,
        stepId: "step_x",
        workflowName: "Flow X",
      },
    });
    // Create a second workspace to get a second row with the same workflowId/stepId
    const ws2 = await createTestWorkspace({ ownerId: state.testUser.id, slug: `ws2-${Date.now()}` });
    await db.promptUsage.create({
      data: {
        workspaceId: ws2.id,
        promptId: prompt.id,
        promptName: "DEDUP_TEST_PROMPT",
        workflowId: 10,
        stepId: "step_x",
        workflowName: "Flow X dup",
      },
    });

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    const body = await res.json();
    const found = body.data.prompts.find((p: { name: string }) => p.name === "DEDUP_TEST_PROMPT");
    expect(found.usages).toHaveLength(1);
    expect(found.usages[0]).toEqual({ workflow_id: 10, workflow_name: "Flow X", step_id: "step_x" });
  });

  test("maps workflowName null to empty string", async () => {
    const prompt = await createPrompt("NULL_WORKFLOWNAME_PROMPT");
    await seedPromptUsage(prompt.id, "NULL_WORKFLOWNAME_PROMPT", 5, "s5", undefined);

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    const body = await res.json();
    const found = body.data.prompts.find(
      (p: { name: string }) => p.name === "NULL_WORKFLOWNAME_PROMPT",
    );
    expect(found.usages[0].workflow_name).toBe("");
  });

  test("prompt with no PromptUsage rows gets usages: []", async () => {
    await createPrompt("NO_USAGE_PROMPT");

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    const body = await res.json();
    const found = body.data.prompts.find((p: { name: string }) => p.name === "NO_USAGE_PROMPT");
    expect(found.usages).toEqual([]);
  });

  test("cross-version run_count total aggregated from PromptDailyRun", async () => {
    const prompt = await createPrompt("RUN_COUNT_TOTAL_PROMPT");
    const versionId = prompt.current_version_id;

    // Seed two daily run rows: one with versionId, one without (null)
    await seedPromptDailyRun(prompt.id, versionId, 30);
    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId: null,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-02"),
        runCount: 20,
        hiveVersionId: "unknown",
      },
    });

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    const body = await res.json();
    const found = body.data.prompts.find(
      (p: { name: string }) => p.name === "RUN_COUNT_TOTAL_PROMPT",
    );
    expect(found.run_count).toBe(50); // 30 + 20
  });

  test("run_count defaults to 0 when no PromptDailyRun rows", async () => {
    await createPrompt("ZERO_RUN_COUNT_PROMPT");

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    const body = await res.json();
    const found = body.data.prompts.find(
      (p: { name: string }) => p.name === "ZERO_RUN_COUNT_PROMPT",
    );
    expect(found.run_count).toBe(0);
  });

  test("empty mirror tables → 200 with usages: [] and run_count: 0 (no error)", async () => {
    await createPrompt("EMPTY_TABLES_PROMPT");

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const found = body.data.prompts.find((p: { name: string }) => p.name === "EMPTY_TABLES_PROMPT");
    expect(found.usages).toEqual([]);
    expect(found.run_count).toBe(0);
  });

  test("without include_usages, prompts do not have usages or run_count fields", async () => {
    await createPrompt("NO_USAGES_PARAM_PROMPT");

    authAs(state.testUser);
    const req = makeReq("http://localhost/api/workflow/prompts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.prompts.find(
      (p: { name: string }) => p.name === "NO_USAGES_PARAM_PROMPT",
    );
    expect(found.usages).toBeUndefined();
    expect(found.run_count).toBeUndefined();
    // No Stakwork calls should be made for usages
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("include_usages"),
      expect.anything(),
    );
  });

  test("does NOT issue one query per prompt (single groupBy, not N+1)", async () => {
    // Create two prompts — verify only one groupBy query is issued, not 2
    await createPrompt("BATCH_PROMPT_ONE");
    await createPrompt("BATCH_PROMPT_TWO");

    // vi.spyOn on a Prisma Proxy corrupts the Proxy's descriptor on restoreAllMocks():
    // getOwnPropertyDescriptor returns {value: undefined, ...} and restoreAllMocks() uses
    // defineProperty to restore that descriptor, setting groupBy to undefined for all
    // subsequent tests. Use a manual call-through wrapper via assignment instead.
    let groupByCallCount = 0;
    const originalGroupBy = db.promptDailyRun.groupBy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.promptDailyRun as any).groupBy = function (...args: unknown[]) {
      groupByCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalGroupBy as any).apply(db.promptDailyRun, args);
    };

    try {
      authAs(state.testUser);
      const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
      const res = await GET(req);
      expect(res.status).toBe(200);
      // Exactly one groupBy call should be issued regardless of page size
      expect(groupByCallCount).toBe(1);
    } finally {
      // Restore via assignment to avoid defineProperty/descriptor corruption
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db.promptDailyRun as any).groupBy = originalGroupBy;
    }
  });
});

// ─── Versions list run_count enrichment ───────────────────────────────────────

describe("GET /api/workflow/prompts/[id]/versions", () => {
  let state: SharedState;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
    mockIsDevelopmentMode.mockReturnValue(false);
    state = await setupSharedState();
  });

  afterEach(async () => {
    if (state.createdPromptIds.length > 0) {
      await db.prompt.deleteMany({ where: { id: { in: state.createdPromptIds } } });
      state.createdPromptIds.length = 0;
    }
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string) {
    mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(state.testUser));
    stakworkOkCreate();
    const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
      name,
      value: "initial value",
    });
    const res = await POST(req);
    const body = await res.json();
    state.createdPromptIds.push(body.data.id);
    return body.data as { id: string; name: string; current_version_id: string };
  }

  test("per-version run_count from PromptDailyRun", async () => {
    const prompt = await createPrompt("VERSIONS_RUNCOUNT");
    const versionId = prompt.current_version_id;
    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-01"),
        runCount: 42,
        hiveVersionId: versionId,
      },
    });

    authAs(state.testUser);
    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const version = body.data.versions[0];
    expect(version.run_count).toBe(42);
  });

  test("version with no PromptDailyRun rows gets run_count: 0", async () => {
    const prompt = await createPrompt("VERSIONS_ZERO_RUNCOUNT");

    authAs(state.testUser);
    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    const version = body.data.versions[0];
    expect(version.run_count).toBe(0);
  });

  test("total_run_count includes null-versionId rows", async () => {
    const prompt = await createPrompt("TOTAL_RUN_COUNT_PROMPT");
    const versionId = prompt.current_version_id;

    // Version-attributed row
    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-01"),
        runCount: 15,
        hiveVersionId: versionId,
      },
    });
    // Null-versionId row (still counts toward prompt total)
    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId: null,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-02"),
        runCount: 10,
        hiveVersionId: "unknown",
      },
    });

    authAs(state.testUser);
    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    const body = await res.json();
    // total_run_count = 15 + 10 = 25
    expect(body.data.total_run_count).toBe(25);
    // per-version run_count = 15 (only version-attributed row)
    const version = body.data.versions.find((v: { id: string }) => v.id === versionId);
    expect(version.run_count).toBe(15);
  });

  test("empty mirror table → 200 with run_count: 0 and total_run_count: 0", async () => {
    const prompt = await createPrompt("EMPTY_VERSIONS_PROMPT");

    authAs(state.testUser);
    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total_run_count).toBe(0);
    expect(body.data.versions[0].run_count).toBe(0);
  });
});

// ─── Single-version run_count enrichment ─────────────────────────────────────

describe("GET /api/workflow/prompts/[id]/versions/[versionId]", () => {
  let state: SharedState;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
    mockIsDevelopmentMode.mockReturnValue(false);
    state = await setupSharedState();
  });

  afterEach(async () => {
    if (state.createdPromptIds.length > 0) {
      await db.prompt.deleteMany({ where: { id: { in: state.createdPromptIds } } });
      state.createdPromptIds.length = 0;
    }
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string) {
    mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(state.testUser));
    stakworkOkCreate();
    const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
      name,
      value: "initial value",
    });
    const res = await POST(req);
    const body = await res.json();
    state.createdPromptIds.push(body.data.id);
    return body.data as { id: string; name: string; current_version_id: string };
  }

  test("returns correct scoped run_count from PromptDailyRun", async () => {
    const prompt = await createPrompt("SINGLE_VER_RUNCOUNT");
    const versionId = prompt.current_version_id;

    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-01"),
        runCount: 7,
        hiveVersionId: versionId,
      },
    });

    authAs(state.testUser);
    const req = makeReq(
      `http://localhost/api/workflow/prompts/${prompt.id}/versions/${versionId}`,
    );
    const res = await GET_VERSION_BY_ID(req, {
      params: Promise.resolve({ id: prompt.id, versionId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.run_count).toBe(7);
  });

  test("returns run_count: 0 when no matching PromptDailyRun rows", async () => {
    const prompt = await createPrompt("SINGLE_VER_ZERO");
    const versionId = prompt.current_version_id;

    authAs(state.testUser);
    const req = makeReq(
      `http://localhost/api/workflow/prompts/${prompt.id}/versions/${versionId}`,
    );
    const res = await GET_VERSION_BY_ID(req, {
      params: Promise.resolve({ id: prompt.id, versionId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.run_count).toBe(0);
  });

  test("scopes to correct version (ignores other versions' rows)", async () => {
    const prompt = await createPrompt("SINGLE_VER_SCOPED");
    const versionId = prompt.current_version_id;

    // Create a real second version (FK constraint requires it to exist in prompt_versions)
    const otherVersion = await db.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionNumber: 2,
        value: "other version value",
        whodunnit: state.testUser.id,
        published: false,
      },
    });
    const otherVersionId = otherVersion.id;

    // Seed a run-count row for the other version — the queried version should return 0
    await db.promptDailyRun.create({
      data: {
        promptId: prompt.id,
        versionId: otherVersionId,
        workflowId: 1,
        customerId: 1,
        runDate: new Date("2025-01-01"),
        runCount: 99,
        hiveVersionId: otherVersionId,
      },
    });

    authAs(state.testUser);
    const req = makeReq(
      `http://localhost/api/workflow/prompts/${prompt.id}/versions/${versionId}`,
    );
    const res = await GET_VERSION_BY_ID(req, {
      params: Promise.resolve({ id: prompt.id, versionId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.run_count).toBe(0);
  });

  test("empty mirror table → 200 with run_count: 0", async () => {
    const prompt = await createPrompt("SINGLE_VER_EMPTY");
    const versionId = prompt.current_version_id;

    authAs(state.testUser);
    const req = makeReq(
      `http://localhost/api/workflow/prompts/${prompt.id}/versions/${versionId}`,
    );
    const res = await GET_VERSION_BY_ID(req, {
      params: Promise.resolve({ id: prompt.id, versionId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.run_count).toBe(0);
    expect(body.success).toBe(true);
  });
});
