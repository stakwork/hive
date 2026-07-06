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
import { GET } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import { POST } from "@/app/api/workflow/prompts/route";
import {
  getMockedSession,
  createAuthenticatedSession,
  expectSuccess,
  expectUnauthorized,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

// ─── Module mocks ──────────────────────────────────────────────────────────────

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
