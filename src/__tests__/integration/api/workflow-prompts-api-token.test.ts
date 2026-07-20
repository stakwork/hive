/**
 * Integration tests: x-api-token auth on prompt read endpoints.
 *
 * Covers:
 *  - GET /api/workflow/prompts           (list)
 *  - GET /api/workflow/prompts/[id]      (single prompt)
 *  - GET /api/workflow/prompts/[id]/versions
 *  - GET /api/workflow/prompts/[id]/versions/[versionId]
 *
 * For each route:
 *  1. Valid x-api-token → 200 with same shape as session-auth
 *  2. Invalid token + no session → 401
 *  3. For /versions routes: valid token bypasses stakwork-workspace membership check
 *  4. Regression: existing session-cookie path continues to work
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID, PUT, PATCH } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import { POST as POST_PUBLISH } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route";
import { API_TOKEN_ACTOR } from "@/lib/auth/api-token";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import {
  getMockedSession,
  createAuthenticatedSession,
  expectSuccess,
  expectUnauthorized,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/rate-limit", () => ({
  getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
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

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn().mockResolvedValue({ id: 1 }),
  })),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_API_TOKEN = "test-prompt-read-api-token";
const WRONG_API_TOKEN = "wrong-token";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockGetServerSession = getMockedSession();

// Mock global fetch for Stakwork push (write-through, best-effort)
global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

function makeReq(
  url: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeGetWithToken(url: string, token: string): NextRequest {
  return makeReq(url, "GET", undefined, { "x-api-token": token });
}

function makeGetNoAuth(url: string): NextRequest {
  return makeReq(url, "GET");
}

let nameCounter = 0;
function uniqueName(base: string): string {
  return `${base}_${++nameCounter}`;
}

// Track created prompt ids for cleanup
const createdPromptIds: string[] = [];

async function cleanupPrompts() {
  if (createdPromptIds.length > 0) {
    await db.prompt.deleteMany({ where: { id: { in: [...createdPromptIds] } } });
    createdPromptIds.length = 0;
  }
}

// ─── Shared fixture setup ─────────────────────────────────────────────────────

describe("x-api-token auth on prompt read endpoints", () => {
  let testUser: { id: string; email: string | null };
  let nonMemberUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let promptId: string;
  let publishedVersionId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Default: Stakwork sync returns success
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 42 } }),
    } as Response);

    // Set the API token env var for validateApiToken to check against
    process.env.API_TOKEN = TEST_API_TOKEN;

    testUser = await createTestUser();
    nonMemberUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "stakwork",
    });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a prompt via session auth (to have test data)
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    const name = uniqueName("API_TOKEN_TEST_PROMPT");
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "prompt content" }),
    );
    const created = (await res.json()).data;
    promptId = created.id;
    publishedVersionId = created.published_version_id as string;
    createdPromptIds.push(promptId);

    // Reset session mock — tests control this from here
    mockGetServerSession.mockReset();
    // Ensure no accidental session leaks
    mockGetServerSession.mockResolvedValue(null);
  });

  afterEach(async () => {
    await cleanupPrompts();
    delete process.env.API_TOKEN;
    vi.restoreAllMocks();
  });

  // ─── GET /api/workflow/prompts (list) ────────────────────────────────────────

  describe("GET /api/workflow/prompts — list", () => {
    test("valid x-api-token returns 200 with prompts list", async () => {
      const response = await GET(makeGetWithToken("http://localhost/api/workflow/prompts", TEST_API_TOKEN));
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.prompts)).toBe(true);
      expect(typeof data.data.total).toBe("number");
      expect(typeof data.data.page).toBe("number");
      expect(typeof data.data.size).toBe("number");
    });

    test("valid token returns the created prompt in the list", async () => {
      const response = await GET(makeGetWithToken("http://localhost/api/workflow/prompts", TEST_API_TOKEN));
      const data = await expectSuccess(response, 200);
      const found = data.data.prompts.find((p: { id: string }) => p.id === promptId);
      expect(found).toBeDefined();
    });

    test("invalid token + no session returns 401", async () => {
      const response = await GET(makeGetWithToken("http://localhost/api/workflow/prompts", WRONG_API_TOKEN));
      await expectUnauthorized(response);
    });

    test("no token and no session returns 401", async () => {
      const response = await GET(makeGetNoAuth("http://localhost/api/workflow/prompts"));
      await expectUnauthorized(response);
    });

    test("session-auth path still works (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const response = await GET(makeGetNoAuth("http://localhost/api/workflow/prompts"));
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.prompts)).toBe(true);
    });

    test("valid token response shape matches session-auth response shape", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const sessionResponse = await GET(makeGetNoAuth("http://localhost/api/workflow/prompts"));
      const sessionData = await sessionResponse.json();

      const tokenResponse = await GET(makeGetWithToken("http://localhost/api/workflow/prompts", TEST_API_TOKEN));
      const tokenData = await tokenResponse.json();

      expect(tokenResponse.status).toBe(sessionResponse.status);
      expect(Object.keys(tokenData)).toEqual(Object.keys(sessionData));
      expect(Object.keys(tokenData.data)).toEqual(Object.keys(sessionData.data));
    });
  });

  // ─── GET /api/workflow/prompts/[id] (single prompt) ──────────────────────────

  describe("GET /api/workflow/prompts/[id] — single prompt", () => {
    test("valid x-api-token returns 200 with prompt detail", async () => {
      const response = await GET_BY_ID(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}`, TEST_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(promptId);
      expect(typeof data.data.name).toBe("string");
      expect(typeof data.data.value).toBe("string");
    });

    test("invalid token + no session returns 401", async () => {
      const response = await GET_BY_ID(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}`, WRONG_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("no token and no session returns 401", async () => {
      const response = await GET_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}`),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("session-auth path still works (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const response = await GET_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}`),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.id).toBe(promptId);
    });

    test("valid token response shape matches session-auth response shape", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const sessionResponse = await GET_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}`),
        { params: Promise.resolve({ id: promptId }) },
      );
      const sessionData = await sessionResponse.json();

      const tokenResponse = await GET_BY_ID(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}`, TEST_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      const tokenData = await tokenResponse.json();

      expect(tokenResponse.status).toBe(sessionResponse.status);
      expect(Object.keys(tokenData.data)).toEqual(Object.keys(sessionData.data));
    });
  });

  // ─── GET /api/workflow/prompts/[id]/versions ─────────────────────────────────

  describe("GET /api/workflow/prompts/[id]/versions — version list", () => {
    test("valid x-api-token returns 200 with versions list", async () => {
      const response = await GET_VERSIONS(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}/versions`, TEST_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.versions)).toBe(true);
      expect(data.data.prompt_id).toBe(promptId);
    });

    test("invalid token + no session returns 401", async () => {
      const response = await GET_VERSIONS(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}/versions`, WRONG_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("no token and no session returns 401", async () => {
      const response = await GET_VERSIONS(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions`),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("valid token bypasses stakwork-workspace membership check (non-member caller succeeds)", async () => {
      // nonMemberUser is NOT a member of the stakwork workspace — session auth would give 403.
      // API token should succeed regardless.
      const response = await GET_VERSIONS(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}/versions`, TEST_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.versions)).toBe(true);
    });

    test("session auth without stakwork membership returns 403 (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: nonMemberUser.id, email: nonMemberUser.email ?? "" }),
      );
      const response = await GET_VERSIONS(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions`),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(response.status).toBe(403);
    });

    test("session-auth with stakwork membership still works (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const response = await GET_VERSIONS(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions`),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("valid token response shape matches session-auth response shape", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const sessionResponse = await GET_VERSIONS(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions`),
        { params: Promise.resolve({ id: promptId }) },
      );
      const sessionData = await sessionResponse.json();

      const tokenResponse = await GET_VERSIONS(
        makeGetWithToken(`http://localhost/api/workflow/prompts/${promptId}/versions`, TEST_API_TOKEN),
        { params: Promise.resolve({ id: promptId }) },
      );
      const tokenData = await tokenResponse.json();

      expect(tokenResponse.status).toBe(sessionResponse.status);
      expect(Object.keys(tokenData.data)).toEqual(Object.keys(sessionData.data));
    });
  });

  // ─── GET /api/workflow/prompts/[id]/versions/[versionId] ─────────────────────

  describe("GET /api/workflow/prompts/[id]/versions/[versionId] — single version", () => {
    test("valid x-api-token returns 200 with version detail", async () => {
      const response = await GET_VERSION_BY_ID(
        makeGetWithToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`,
          TEST_API_TOKEN,
        ),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(publishedVersionId);
      expect(data.data.prompt_id).toBe(promptId);
      expect(typeof data.data.value).toBe("string");
      expect(typeof data.data.version_number).toBe("number");
    });

    test("invalid token + no session returns 401", async () => {
      const response = await GET_VERSION_BY_ID(
        makeGetWithToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`,
          WRONG_API_TOKEN,
        ),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      await expectUnauthorized(response);
    });

    test("no token and no session returns 401", async () => {
      const response = await GET_VERSION_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      await expectUnauthorized(response);
    });

    test("valid token bypasses stakwork-workspace membership check (non-member caller succeeds)", async () => {
      // nonMemberUser would get 403 via session auth — token should succeed regardless.
      const response = await GET_VERSION_BY_ID(
        makeGetWithToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`,
          TEST_API_TOKEN,
        ),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(publishedVersionId);
    });

    test("session auth without stakwork membership returns 403 (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: nonMemberUser.id, email: nonMemberUser.email ?? "" }),
      );
      const response = await GET_VERSION_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      expect(response.status).toBe(403);
    });

    test("session-auth with stakwork membership still works (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const response = await GET_VERSION_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(publishedVersionId);
    });

    test("valid token response shape matches session-auth response shape", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const sessionResponse = await GET_VERSION_BY_ID(
        makeGetNoAuth(`http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      const sessionData = await sessionResponse.json();

      const tokenResponse = await GET_VERSION_BY_ID(
        makeGetWithToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${publishedVersionId}`,
          TEST_API_TOKEN,
        ),
        { params: Promise.resolve({ id: promptId, versionId: publishedVersionId }) },
      );
      const tokenData = await tokenResponse.json();

      expect(tokenResponse.status).toBe(sessionResponse.status);
      expect(Object.keys(tokenData.data)).toEqual(Object.keys(sessionData.data));
    });
  });
});

// ─── Write endpoint tests ─────────────────────────────────────────────────────

describe("x-api-token auth on prompt write endpoints", () => {
  let testUser: { id: string; email: string | null };
  let nonMemberUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let promptId: string;

  const mockGetServerSession = getMockedSession();
  const mockCheckRateLimit = vi.mocked(checkRateLimit);

  // Track created prompt ids for cleanup
  const createdPromptIds: string[] = [];
  let nameCounter = 0;
  function uniqueName(base: string) {
    return `${base}_W${++nameCounter}_${Date.now()}`;
  }

  function makeReq(
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): NextRequest {
    return new NextRequest(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function withToken(url: string, method: string, body?: unknown): NextRequest {
    return makeReq(url, method, body, { "x-api-token": TEST_API_TOKEN });
  }
  function withWrongToken(url: string, method: string, body?: unknown): NextRequest {
    return makeReq(url, method, body, { "x-api-token": WRONG_API_TOKEN });
  }
  function withSession(url: string, method: string, body?: unknown): NextRequest {
    return makeReq(url, method, body);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    process.env.API_TOKEN = TEST_API_TOKEN;

    testUser = await createTestUser();
    nonMemberUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "stakwork",
    });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a prompt via session auth for PUT/PATCH tests
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: uniqueName("WRITE_TOKEN_BASE"),
        value: "base content",
      }),
    );
    const created = (await res.json()).data;
    promptId = created.id;
    createdPromptIds.push(promptId);

    // Reset session mock — each test controls it with mockResolvedValueOnce
    mockGetServerSession.mockReset();
    mockGetServerSession.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (createdPromptIds.length > 0) {
      await db.promptVersion.deleteMany({ where: { promptId: { in: [...createdPromptIds] } } });
      await db.prompt.deleteMany({ where: { id: { in: [...createdPromptIds] } } });
      createdPromptIds.length = 0;
    }
    delete process.env.API_TOKEN;
    vi.restoreAllMocks();
  });

  // ─── POST /api/workflow/prompts ───────────────────────────────────────────────

  describe("POST /api/workflow/prompts", () => {
    test("valid x-api-token, no session → 200 with created prompt", async () => {
      const name = uniqueName("TOKEN_CREATE");
      const res = await POST(withToken("http://localhost/api/workflow/prompts", "POST", { name, value: "hello" }));
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
      expect(data.data.name).toBe(name);
      createdPromptIds.push(data.data.id);
    });

    test("valid token → whodunnit is 'api-token' on created PromptVersion", async () => {
      const name = uniqueName("TOKEN_WHODUNNIT");
      const res = await POST(withToken("http://localhost/api/workflow/prompts", "POST", { name, value: "v1" }));
      const data = await expectSuccess(res);
      createdPromptIds.push(data.data.id);

      const version = await db.promptVersion.findFirst({
        where: { promptId: data.data.id },
        orderBy: { versionNumber: "desc" },
      });
      expect(version).toBeDefined();
      expect(version!.whodunnit).toBe("api-token");
    });

    test("valid token bypasses workspace membership gate (non-member would fail session auth)", async () => {
      // nonMemberUser has no membership — if session were used with them it would 403.
      // But token auth skips the gate entirely.
      const name = uniqueName("TOKEN_BYPASS");
      const res = await POST(withToken("http://localhost/api/workflow/prompts", "POST", { name, value: "bypass" }));
      expect(res.status).not.toBe(403);
      const data = await res.json();
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });

    test("session auth, no token → still succeeds (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const name = uniqueName("SESSION_CREATE");
      const res = await POST(withSession("http://localhost/api/workflow/prompts", "POST", { name, value: "session" }));
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });

    test("session auth → whodunnit is the real userId", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const name = uniqueName("SESSION_WHODUNNIT");
      const res = await POST(withSession("http://localhost/api/workflow/prompts", "POST", { name, value: "v" }));
      const data = await expectSuccess(res);
      createdPromptIds.push(data.data.id);

      const version = await db.promptVersion.findFirst({
        where: { promptId: data.data.id },
        orderBy: { versionNumber: "desc" },
      });
      expect(version!.whodunnit).toBe(testUser.id);
    });

    test("missing token AND no session → 401", async () => {
      const res = await POST(withSession("http://localhost/api/workflow/prompts", "POST", { name: "UNUSED", value: "x" }));
      await expectUnauthorized(res);
    });

    test("wrong-but-same-length token, no session → 401 (falls through to session, no silent success)", async () => {
      // Construct a wrong token of the same byte length as the real one
      const sameLenWrong = "X".repeat(TEST_API_TOKEN.length);
      const req = makeReq("http://localhost/api/workflow/prompts", "POST", { name: "UNUSED", value: "x" }, { "x-api-token": sameLenWrong });
      const res = await POST(req);
      await expectUnauthorized(res);
    });

    test("wrong-length token, no session → 401 (no exception from timingSafeEqual)", async () => {
      const req = makeReq("http://localhost/api/workflow/prompts", "POST", { name: "UNUSED", value: "x" }, { "x-api-token": "short" });
      const res = await POST(req);
      await expectUnauthorized(res);
    });

    test("rate limit exceeded → 429 with Retry-After header, no DB write", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
      const name = uniqueName("RATE_LIMITED");
      const res = await POST(withToken("http://localhost/api/workflow/prompts", "POST", { name, value: "x" }));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
      // No prompt created
      const created = await db.prompt.findFirst({ where: { name } });
      expect(created).toBeNull();
    });

    test("rate limit allowed → write proceeds normally", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true });
      const name = uniqueName("RATE_OK");
      const res = await POST(withToken("http://localhost/api/workflow/prompts", "POST", { name, value: "y" }));
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });
  });

  // ─── PUT /api/workflow/prompts/[id] ──────────────────────────────────────────

  describe("PUT /api/workflow/prompts/[id]", () => {
    test("valid x-api-token, no session → 200 with updated prompt", async () => {
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "updated by token" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(promptId);
    });

    test("valid token → whodunnit is 'api-token' on new draft PromptVersion", async () => {
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "token update" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectSuccess(res);

      const version = await db.promptVersion.findFirst({
        where: { promptId },
        orderBy: { versionNumber: "desc" },
      });
      expect(version).toBeDefined();
      expect(version!.whodunnit).toBe("api-token");
    });

    test("valid token bypasses workspace membership gate", async () => {
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "bypass" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(res.status).not.toBe(403);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    test("session auth, no token → still succeeds (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const res = await PUT(
        withSession(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "session update" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
    });

    test("session auth → whodunnit is the real userId", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const res = await PUT(
        withSession(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "session v" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectSuccess(res);

      const version = await db.promptVersion.findFirst({
        where: { promptId },
        orderBy: { versionNumber: "desc" },
      });
      expect(version!.whodunnit).toBe(testUser.id);
    });

    test("missing token AND no session → 401", async () => {
      const res = await PUT(
        withSession(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "x" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(res);
    });

    test("wrong-but-same-length token, no session → 401", async () => {
      const sameLenWrong = "X".repeat(TEST_API_TOKEN.length);
      const req = makeReq(
        `http://localhost/api/workflow/prompts/${promptId}`,
        "PUT",
        { value: "x" },
        { "x-api-token": sameLenWrong },
      );
      const res = await PUT(req, { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });

    test("wrong-length token, no session → 401 (no exception)", async () => {
      const req = makeReq(
        `http://localhost/api/workflow/prompts/${promptId}`,
        "PUT",
        { value: "x" },
        { "x-api-token": "short" },
      );
      const res = await PUT(req, { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });

    test("rate limit exceeded → 429 with Retry-After header, no DB write", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
      const beforeVersions = await db.promptVersion.count({ where: { promptId } });
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "blocked" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("30");
      const afterVersions = await db.promptVersion.count({ where: { promptId } });
      expect(afterVersions).toBe(beforeVersions);
    });

    test("rate limit allowed → write proceeds", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true });
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "ok update" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
    });
  });

  // ─── PATCH /api/workflow/prompts/[id] ─────────────────────────────────────────

  describe("PATCH /api/workflow/prompts/[id]", () => {
    test("valid x-api-token, no session → 200 with updated prompt", async () => {
      const res = await PATCH(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(promptId);
    });

    test("valid token bypasses workspace membership gate", async () => {
      const res = await PATCH(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(res.status).not.toBe(403);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    test("valid token PATCH does NOT create a new PromptVersion (unattributed, unversioned)", async () => {
      const beforeCount = await db.promptVersion.count({ where: { promptId } });
      await PATCH(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const afterCount = await db.promptVersion.count({ where: { promptId } });
      expect(afterCount).toBe(beforeCount);
    });

    test("session auth, no token → still succeeds (regression)", async () => {
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const res = await PATCH(
        withSession(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
    });

    test("missing token AND no session → 401", async () => {
      const res = await PATCH(
        withSession(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(res);
    });

    test("wrong-but-same-length token, no session → 401", async () => {
      const sameLenWrong = "X".repeat(TEST_API_TOKEN.length);
      const req = makeReq(
        `http://localhost/api/workflow/prompts/${promptId}`,
        "PATCH",
        { agentNames: [] },
        { "x-api-token": sameLenWrong },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });

    test("wrong-length token, no session → 401 (no exception)", async () => {
      const req = makeReq(
        `http://localhost/api/workflow/prompts/${promptId}`,
        "PATCH",
        { agentNames: [] },
        { "x-api-token": "short" },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });

    test("rate limit exceeded → 429 with Retry-After header, agentNames unchanged", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 15 });
      const before = await db.prompt.findUnique({ where: { id: promptId }, select: { agentNames: true } });
      const res = await PATCH(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("15");
      // DB not modified
      const after = await db.prompt.findUnique({ where: { id: promptId }, select: { agentNames: true } });
      expect(after!.agentNames).toEqual(before!.agentNames);
    });

    test("rate limit allowed → write proceeds", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true });
      const res = await PATCH(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PATCH", { agentNames: [] }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);
    });
  });

  // ─── POST /api/workflow/prompts/[id]/versions/[versionId]/publish ─────────────

  describe("POST /api/workflow/prompts/[id]/versions/[versionId]/publish", () => {
    let draftVersionId: string;

    beforeEach(async () => {
      // Create a draft version via token PUT so we have an unpublished version to publish
      const res = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "draft for publish test" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = (await res.json()).data;
      draftVersionId = data.current_version_id as string;
    });

    test("valid x-api-token → 200, published flag flips true in DB", async () => {
      const res = await POST_PUBLISH(
        withToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
          "POST",
        ),
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const version = await db.promptVersion.findUnique({ where: { id: draftVersionId } });
      expect(version).toBeDefined();
      expect(version!.published).toBe(true);
    });

    test("valid x-api-token → publishedBy persisted as API_TOKEN_ACTOR in DB", async () => {
      await POST_PUBLISH(
        withToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
          "POST",
        ),
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );

      const version = await db.promptVersion.findUnique({ where: { id: draftVersionId } });
      expect(version!.publishedBy).toBe(API_TOKEN_ACTOR);
      expect(version!.publishedAt).not.toBeNull();
    });

    test("session user who is NOT a stakwork member → 403 (session branch unchanged)", async () => {
      // publish route uses requireAuth(getMiddlewareContext(request)) — must set middleware headers
      const req = new NextRequest(
        `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
            [MIDDLEWARE_HEADERS.USER_ID]: nonMemberUser.id,
            [MIDDLEWARE_HEADERS.USER_EMAIL]: nonMemberUser.email ?? "",
            [MIDDLEWARE_HEADERS.USER_NAME]: "Non Member",
            [MIDDLEWARE_HEADERS.REQUEST_ID]: "test-req-nonmember",
          },
        },
      );
      const res = await POST_PUBLISH(
        req,
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      expect(res.status).toBe(403);
    });

    test("missing token AND no session → 401", async () => {
      // No middleware headers and no x-api-token → 401
      const res = await POST_PUBLISH(
        withSession(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
          "POST",
        ),
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      await expectUnauthorized(res);
    });

    test("publish rate-limit bucket is independent from PUT/PATCH edit bucket", async () => {
      // Exhaust the publish bucket
      mockCheckRateLimit.mockImplementation(async (key: string) => {
        if (key.startsWith("prompts:publish:api-token:")) {
          return { allowed: false, retryAfter: 60 };
        }
        return { allowed: true };
      });

      // Publish should be 429
      const publishRes = await POST_PUBLISH(
        withToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
          "POST",
        ),
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      expect(publishRes.status).toBe(429);

      // But PUT (edit bucket) should still be allowed
      const putRes = await PUT(
        withToken(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "still fine" }),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(putRes.status).toBe(200);
    });

    test("rate limit exceeded on publish → 429 with Retry-After, published flag unchanged", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });

      const versionBefore = await db.promptVersion.findUnique({
        where: { id: draftVersionId },
        select: { published: true },
      });

      const res = await POST_PUBLISH(
        withToken(
          `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
          "POST",
        ),
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("30");

      const versionAfter = await db.promptVersion.findUnique({
        where: { id: draftVersionId },
        select: { published: true },
      });
      expect(versionAfter!.published).toBe(versionBefore!.published);
    });

    test("session auth with stakwork membership → 200, publishedBy set to userId", async () => {
      // publish route uses requireAuth(getMiddlewareContext(request)) — must set middleware headers
      const req = new NextRequest(
        `http://localhost/api/workflow/prompts/${promptId}/versions/${draftVersionId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
            [MIDDLEWARE_HEADERS.USER_ID]: testUser.id,
            [MIDDLEWARE_HEADERS.USER_EMAIL]: testUser.email ?? "",
            [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
            [MIDDLEWARE_HEADERS.REQUEST_ID]: "test-req-session",
          },
        },
      );
      const res = await POST_PUBLISH(
        req,
        { params: Promise.resolve({ id: promptId, versionId: draftVersionId }) },
      );
      expect(res.status).toBe(200);

      const version = await db.promptVersion.findUnique({ where: { id: draftVersionId } });
      expect(version!.published).toBe(true);
      expect(version!.publishedBy).toBe(testUser.id);
    });
  });
});
