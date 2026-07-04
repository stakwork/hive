/**
 * Integration tests for GET /api/workflow/prompts?include_usages=true
 * and version-history run_count enrichment.
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

/** Mock a successful Stakwork create response */
function stakworkOkCreate(id = 99) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { id } }),
  } as Response);
}

/** Mock Stakwork returning usages for a list of prompt names */
function stakworkOkUsages(
  entries: Array<{ name: string; usages: Array<{ workflow_id: number; workflow_name: string; step_id: string }> }>,
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { prompts: entries } }),
  } as Response);
}

/** Mock Stakwork usages endpoint returning non-2xx (simulates outage) */
function stakworkUsagesDown() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
}

/** Mock Stakwork find_by_version returning run_count */
function stakworkOkRunCount(runCount: number, notation = "PROMPT@v1") {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ notation, run_count: runCount }),
  } as Response);
}

/** Mock Stakwork find_by_version returning 404 */
function stakworkRunCountMiss() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workflow/prompts?include_usages=true", () => {
  let testUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  const createdPromptIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });
  });

  afterEach(async () => {
    if (createdPromptIds.length > 0) {
      await db.prompt.deleteMany({ where: { id: { in: createdPromptIds } } });
      createdPromptIds.length = 0;
    }
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string, value = "test value") {
    mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(testUser));
    stakworkOkCreate();
    const req = makeReq("http://localhost/api/workflow/prompts", "POST", { name, value });
    const res = await POST(req);
    const body = await res.json();
    createdPromptIds.push(body.data.id);
    return body.data as { id: string; name: string; current_version_id: string };
  }

  test("returns usages populated by name when Stakwork has matching data", async () => {
    const prompt = await createPrompt("USAGES_TEST_PROMPT");

    authAs(testUser);
    // The GET will call Stakwork for usages
    stakworkOkUsages([
      {
        name: "USAGES_TEST_PROMPT",
        usages: [
          { workflow_id: 101, workflow_name: "Flow A", step_id: "step_1" },
          { workflow_id: 102, workflow_name: "Flow B", step_id: "step_2" },
        ],
      },
    ]);

    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const found = body.data.prompts.find((p: { name: string }) => p.name === "USAGES_TEST_PROMPT");
    expect(found).toBeTruthy();
    expect(found.usages).toEqual([
      { workflow_id: 101, workflow_name: "Flow A", step_id: "step_1" },
      { workflow_id: 102, workflow_name: "Flow B", step_id: "step_2" },
    ]);
    expect(found).toHaveProperty("id", prompt.id);
  });

  test("prompt with no Stakwork match gets usages: []", async () => {
    await createPrompt("NO_MATCH_PROMPT");

    authAs(testUser);
    // Stakwork returns data for a different prompt
    stakworkOkUsages([
      { name: "SOME_OTHER_PROMPT", usages: [{ workflow_id: 1, workflow_name: "W", step_id: "s" }] },
    ]);

    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.prompts.find((p: { name: string }) => p.name === "NO_MATCH_PROMPT");
    expect(found).toBeTruthy();
    expect(found.usages).toEqual([]);
  });

  test("Stakwork outage still returns 200 with usages: [] for all prompts", async () => {
    await createPrompt("OUTAGE_TEST_PROMPT");

    authAs(testUser);
    // Stakwork is down
    stakworkUsagesDown();

    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const found = body.data.prompts.find((p: { name: string }) => p.name === "OUTAGE_TEST_PROMPT");
    expect(found).toBeTruthy();
    expect(found.usages).toEqual([]);
  });

  test("Stakwork network error still returns 200 with usages: [] for all prompts", async () => {
    await createPrompt("NETWORK_ERR_PROMPT");

    authAs(testUser);
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const found = body.data.prompts.find((p: { name: string }) => p.name === "NETWORK_ERR_PROMPT");
    expect(found).toBeTruthy();
    expect(found.usages).toEqual([]);
  });

  test("without include_usages, prompts do not have usages field", async () => {
    await createPrompt("NO_USAGES_PARAM_PROMPT");

    authAs(testUser);
    const req = makeReq("http://localhost/api/workflow/prompts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.prompts.find(
      (p: { name: string }) => p.name === "NO_USAGES_PARAM_PROMPT",
    );
    expect(found).toBeTruthy();
    expect(found.usages).toBeUndefined();
    // Stakwork should NOT be called for usages when param absent
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("include_usages"),
      expect.anything(),
    );
  });

  test("usages shape matches frontend expectation { workflow_id, workflow_name, step_id }[]", async () => {
    await createPrompt("SHAPE_VERIFY_PROMPT");

    authAs(testUser);
    stakworkOkUsages([
      {
        name: "SHAPE_VERIFY_PROMPT",
        usages: [{ workflow_id: 999, workflow_name: "Test Workflow", step_id: "step_abc" }],
      },
    ]);

    const req = makeReq("http://localhost/api/workflow/prompts?include_usages=true");
    const res = await GET(req);
    const body = await res.json();

    const found = body.data.prompts.find((p: { name: string }) => p.name === "SHAPE_VERIFY_PROMPT");
    const usage = found.usages[0];
    expect(usage).toMatchObject({
      workflow_id: expect.any(Number),
      workflow_name: expect.any(String),
      step_id: expect.any(String),
    });
  });
});

// ─── Version history run_count enrichment ─────────────────────────────────────

describe("Version history run_count enrichment", () => {
  let testUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  const createdPromptIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });
  });

  afterEach(async () => {
    if (createdPromptIds.length > 0) {
      await db.prompt.deleteMany({ where: { id: { in: createdPromptIds } } });
      createdPromptIds.length = 0;
    }
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string) {
    mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(testUser));
    stakworkOkCreate();
    const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
      name,
      value: "initial value",
    });
    const res = await POST(req);
    const body = await res.json();
    createdPromptIds.push(body.data.id);
    return body.data as { id: string; name: string; current_version_id: string };
  }

  test("versions list includes run_count per version from Stakwork", async () => {
    const prompt = await createPrompt("RUNCOUNT_TEST");

    authAs(testUser);
    // One version → one fetchVersionRunCount call
    stakworkOkRunCount(13, "RUNCOUNT_TEST@v1");

    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const version = body.data.versions[0];
    expect(version.run_count).toBe(13);
  });

  test("versions list degrades gracefully (run_count: null) when Stakwork returns 404", async () => {
    const prompt = await createPrompt("RUNCOUNT_MISS");

    authAs(testUser);
    stakworkRunCountMiss();

    const req = makeReq(`http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    const version = body.data.versions[0];
    expect(version.run_count).toBeNull();
  });

  test("single version endpoint includes run_count from Stakwork", async () => {
    const prompt = await createPrompt("SINGLE_VERSION_RUNCOUNT");

    authAs(testUser);
    stakworkOkRunCount(7, "SINGLE_VERSION_RUNCOUNT@v1");

    const versions = await db.promptVersion.findMany({ where: { promptId: prompt.id } });
    const versionId = versions[0].id;

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

  test("single version endpoint degrades to null when Stakwork is down", async () => {
    const prompt = await createPrompt("SINGLE_VERSION_DOWN");

    authAs(testUser);
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const versions = await db.promptVersion.findMany({ where: { promptId: prompt.id } });
    const versionId = versions[0].id;

    const req = makeReq(
      `http://localhost/api/workflow/prompts/${prompt.id}/versions/${versionId}`,
    );
    const res = await GET_VERSION_BY_ID(req, {
      params: Promise.resolve({ id: prompt.id, versionId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.run_count).toBeNull();
  });
});
