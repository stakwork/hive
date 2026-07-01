/**
 * Integration tests for Hive-native prompt routes.
 *
 * These tests operate against the real test database.
 * The routes now read/write Hive directly; Stakwork is pushed best-effort via
 * writePromptThrough / deletePrompt. Stakwork API calls are intercepted via
 * global fetch mock.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

import { isDevelopmentMode } from "@/lib/runtime";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

// Mock global fetch for Stakwork push (write-through, best-effort)
global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Make Stakwork return a successful create response (numeric id). */
function stakworkOkCreate(id = 42) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { id } }),
  } as Response);
}

/** Make Stakwork return a successful update response. */
function stakworkOkUpdate() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true }),
  } as Response);
}

/** Make the next Stakwork call fail silently (best-effort). */
function stakworkFail() {
  mockFetch.mockRejectedValueOnce(new Error("Stakwork is down"));
}

// ─── Shared test state ─────────────────────────────────────────────────────────

// Unique counter to prevent name collisions between test blocks
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

// ─── POST /api/workflow/prompts ────────────────────────────────────────────────

describe("POST /api/workflow/prompts Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "stakwork",
    });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "TEST", value: "v" }),
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "TEST", value: "v" }),
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "TEST", value: "v" }),
      );
      await expectError(response, "Invalid user session", 401);
    });

    test("allows authenticated workspace member to create prompt", async () => {
      authAs(testUser);
      stakworkOkCreate(1);

      const name = uniqueName("AUTH_VALID");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Test value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      authAs(otherUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "FORBIDDEN", value: "v" }),
      );
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace owner to create prompt", async () => {
      authAs(testUser);
      stakworkOkCreate(2);

      const name = uniqueName("OWNER_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Owner value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });

    test("allows workspace member (DEVELOPER role) to create prompt", async () => {
      const memberUser = await createTestUser();
      await db.workspaceMember.create({
        data: { workspaceId: stakworkWorkspace.id, userId: memberUser.id, role: "DEVELOPER" },
      });

      mockGetServerSession.mockResolvedValue(
        createAuthenticatedSession({ id: memberUser.id, email: memberUser.email ?? "" }),
      );
      stakworkOkCreate(3);

      const name = uniqueName("DEV_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Dev value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);
      mockGetServerSession.mockResolvedValue(
        createAuthenticatedSession({ id: otherUser.id, email: otherUser.email ?? "" }),
      );
      stakworkOkCreate(4);

      const name = uniqueName("DEV_MODE_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Dev value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      createdPromptIds.push(data.data.id);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when name is missing", async () => {
      authAs(testUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { value: "Test value" }),
      );
      await expectError(response, "Name and value are required", 400);
    });

    test("returns 400 when value is missing", async () => {
      authAs(testUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "TEST_PROMPT" }),
      );
      await expectError(response, "Name and value are required", 400);
    });

    test("returns 400 when both name and value are missing", async () => {
      authAs(testUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {}),
      );
      await expectError(response, "Name and value are required", 400);
    });

    test("accepts valid prompt with name and value", async () => {
      authAs(testUser);
      stakworkOkCreate(5);

      const name = uniqueName("VALID_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Valid value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.name).toBe(name);
      expect(data.data.value).toBe("Valid value");
      createdPromptIds.push(data.data.id);
    });

    test("returns 400 when name contains lowercase letters", async () => {
      authAs(testUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "invalid name", value: "v" }),
      );
      await expectError(response, "Prompt name must contain only uppercase letters", 400);
    });

    test("returns 400 when name contains numbers or special chars (hyphens)", async () => {
      authAs(testUser);

      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "TEST-123", value: "v" }),
      );
      await expectError(response, "Prompt name must contain only uppercase letters", 400);
    });

    test("accepts valid uppercase+underscore prompt name", async () => {
      authAs(testUser);
      stakworkOkCreate(6);

      const name = uniqueName("VALID_NAME");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "Some value" }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.name).toBe(name);
      createdPromptIds.push(data.data.id);
    });

    test("accepts optional description field", async () => {
      authAs(testUser);
      stakworkOkCreate(7);

      const name = uniqueName("PROMPT_WITH_DESC");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name,
          value: "Value",
          description: "Test description",
        }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.description).toBe("Test description");
      createdPromptIds.push(data.data.id);
    });

    test("returns 409 for duplicate prompt name", async () => {
      authAs(testUser);
      stakworkOkCreate(8);

      const name = uniqueName("DUPE_PROMPT");

      // First create
      const res1 = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "v1" }),
      );
      const d1 = await expectSuccess(res1, 200);
      createdPromptIds.push(d1.data.id);

      // Second create with same name
      authAs(testUser);
      const res2 = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "v2" }),
      );
      expect(res2.status).toBe(409);
    });
  });

  describe("Stakwork write-through Tests", () => {
    test("sends Stakwork payload with correct structure (prompt + hive_version_id)", async () => {
      authAs(testUser);
      stakworkOkCreate(10);

      const name = uniqueName("API_TEST");
      await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name,
          value: "API value",
          description: "Body description",
        }),
      ).then(async (res) => {
        const data = await res.json();
        createdPromptIds.push(data.data.id);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("https://api.stakwork.test");
      expect(opts.headers).toMatchObject({
        Authorization: "Token token=test-stakwork-key-123",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(opts.body as string);
      expect(body.prompt).toMatchObject({ name, value: "API value", description: "Body description" });
      expect(body.prompt.hive_version_id).toBeTruthy();
    });

    test("Stakwork failure is best-effort: local write succeeds, syncStatus=PENDING", async () => {
      authAs(testUser);
      stakworkFail();

      const name = uniqueName("PENDING_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "pending value" }),
      );
      const data = await expectSuccess(response, 200);
      createdPromptIds.push(data.data.id);

      const prompt = await db.prompt.findUnique({ where: { id: data.data.id } });
      expect(prompt!.syncStatus).toBe("PENDING");
    });

    test("handles malformed JSON body with 500", async () => {
      mockGetServerSession.mockResolvedValue(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const request = new NextRequest("http://localhost/api/workflow/prompts", {
        method: "POST",
        body: "invalid json{",
      });
      const response = await POST(request);
      await expectError(response, "Failed to create prompt", 500);
    });

    test("handles empty string values as 400", async () => {
      authAs(testUser);
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name: "", value: "" }),
      );
      await expectError(response, "Name and value are required", 400);
    });

    test("handles very long prompt values", async () => {
      authAs(testUser);
      stakworkOkCreate(11);

      const longValue = "x".repeat(10000);
      const name = uniqueName("LONG_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: longValue }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.value).toBe(longValue);
      createdPromptIds.push(data.data.id);
    });

    test("handles special characters in prompt fields", async () => {
      authAs(testUser);
      stakworkOkCreate(12);

      const name = uniqueName("SPECIAL_PROMPT");
      const response = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name,
          value: "Special \n\t\r value",
        }),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.name).toBe(name);
      createdPromptIds.push(data.data.id);
    });
  });
});

// ─── GET /api/workflow/prompts ─────────────────────────────────────────────────

describe("GET /api/workflow/prompts Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "stakwork",
    });

    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "test@example.com" } } as any);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("allows authenticated workspace member to list prompts", async () => {
      authAs(testUser);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.prompts)).toBe(true);
    });

    test("non-stakwork-member can still list prompts (prompts are global/shared)", async () => {
      // GET /api/workflow/prompts only requires authentication, not workspace membership
      authAs(otherUser);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Pagination Tests", () => {
    test("retrieves prompts with default page 1", async () => {
      authAs(testUser);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      const data = await expectSuccess(response, 200);
      expect(data.data.page).toBe(1);
    });

    test("retrieves prompts with specified page parameter", async () => {
      authAs(testUser);

      const response = await GET(
        makeReq("http://localhost/api/workflow/prompts?page=2", "GET"),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.page).toBe(2);
    });
  });

  describe("Filtering / Search Tests", () => {
    test("search filters prompts by name", async () => {
      authAs(testUser);
      stakworkOkCreate(20);

      // Create a prompt to search for
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      const name = uniqueName("SEARCHABLE");
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "search value" }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      const response = await GET(
        makeReq(`http://localhost/api/workflow/prompts?search=${name}`, "GET"),
      );
      const data = await expectSuccess(response, 200);
      const found = data.data.prompts.find((p: { name: string }) => p.name === name);
      expect(found).toBeTruthy();
    });

    test("returns empty array when no prompts match search", async () => {
      authAs(testUser);

      const response = await GET(
        makeReq("http://localhost/api/workflow/prompts?search=TOTALLY_NONEXISTENT_XYZ9999", "GET"),
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.prompts).toHaveLength(0);
    });

    test("search does not call Stakwork (reads from Hive)", async () => {
      authAs(testUser);

      await GET(makeReq("http://localhost/api/workflow/prompts?search=test", "GET"));
      // No fetch calls for GET (reads from Hive DB)
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Response shape Tests", () => {
    test("response includes success, data.prompts, data.total, data.page, data.size", async () => {
      authAs(testUser);

      const response = await GET(makeReq("http://localhost/api/workflow/prompts", "GET"));
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("prompts");
      expect(data.data).toHaveProperty("total");
      expect(data.data).toHaveProperty("page");
      expect(data.data).toHaveProperty("size");
    });
  });
});

// ─── GET /api/workflow/prompts/[id] ───────────────────────────────────────────

describe("GET /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let existingPromptId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a real Hive prompt for read tests
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkCreate(50);
    const name = uniqueName("GET_BY_ID_PROMPT");
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "get by id value" }),
    );
    const created = (await res.json()).data;
    existingPromptId = created.id;
    createdPromptIds.push(existingPromptId);
    // Clear call history from setup so tests start with a clean slate
    mockFetch.mockClear();
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await GET_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "GET"),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when id is missing", async () => {
      authAs(testUser);

      const response = await GET_BY_ID(
        makeReq("http://localhost/api/workflow/prompts/", "GET"),
        { params: Promise.resolve({ id: "" }) },
      );
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Retrieval Tests", () => {
    test("successfully retrieves prompt by Hive id", async () => {
      authAs(testUser);

      const response = await GET_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "GET"),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(existingPromptId);
      expect(data.data.value).toBe("get by id value");
    });

    test("returns 404 for non-existent id", async () => {
      authAs(testUser);

      const response = await GET_BY_ID(
        makeReq("http://localhost/api/workflow/prompts/nonexistent", "GET"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });

    test("GET by id does not call Stakwork (reads from Hive)", async () => {
      authAs(testUser);

      await GET_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "GET"),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("response shape includes id, name, value, published_version_id, sync_status", async () => {
      authAs(testUser);

      const response = await GET_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "GET"),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("value");
      expect(data.data).toHaveProperty("published_version_id");
      expect(data.data).toHaveProperty("sync_status");
    });
  });
});

// ─── PUT /api/workflow/prompts/[id] ───────────────────────────────────────────

describe("PUT /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let existingPromptId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a prompt to update in tests
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkCreate(60);
    const name = uniqueName("PUT_TARGET_PROMPT");
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "original value" }),
    );
    const created = (await res.json()).data;
    existingPromptId = created.id;
    createdPromptIds.push(existingPromptId);
    // Clear call history from setup so tests start with a clean slate
    mockFetch.mockClear();
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", { value: "v" }),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when value is missing", async () => {
      authAs(testUser);

      const response = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", {}),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      await expectError(response, "Value is required", 400);
    });

    test("returns 400 when id is missing", async () => {
      authAs(testUser);

      const response = await PUT(
        makeReq("http://localhost/api/workflow/prompts/", "PUT", { value: "v" }),
        { params: Promise.resolve({ id: "" }) },
      );
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Update Tests", () => {
    test("successfully updates prompt value; creates new published version", async () => {
      authAs(testUser);
      stakworkOkUpdate();

      const response = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", {
          value: "Updated value",
        }),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.value).toBe("Updated value");

      // Verify Hive DB invariant: Prompt.value mirrors published version
      const prompt = await db.prompt.findUnique({
        where: { id: existingPromptId },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });
      expect(prompt!.value).toBe("Updated value");
      expect(prompt!.versions).toHaveLength(2);
      expect(prompt!.versions[1].published).toBe(true);
      expect(prompt!.versions[0].published).toBe(false);
    });

    test("updates prompt with optional description", async () => {
      authAs(testUser);
      stakworkOkUpdate();

      const response = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", {
          value: "New value",
          description: "New description",
        }),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.description).toBe("New description");
    });

    test("returns 404 for non-existent id", async () => {
      authAs(testUser);

      const response = await PUT(
        makeReq("http://localhost/api/workflow/prompts/nonexistent", "PUT", { value: "v" }),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("Stakwork write-through Tests", () => {
    test("PUT sends hive_version_id in Stakwork payload", async () => {
      authAs(testUser);
      stakworkOkUpdate();

      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", {
          value: "Updated",
          description: "Updated description",
        }),
        { params: Promise.resolve({ id: existingPromptId }) },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body.prompt.hive_version_id).toBeTruthy();
      expect(body.prompt.value).toBe("Updated");
    });

    test("Stakwork update failure is best-effort: local write still succeeds, syncStatus=PENDING", async () => {
      // Set a stakworkId so update path is triggered
      await db.prompt.update({
        where: { id: existingPromptId },
        data: { stakworkId: 60 },
      });

      authAs(testUser);
      stakworkFail();

      const response = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${existingPromptId}`, "PUT", { value: "v2" }),
        { params: Promise.resolve({ id: existingPromptId }) },
      );
      await expectSuccess(response, 200);

      const prompt = await db.prompt.findUnique({ where: { id: existingPromptId } });
      expect(prompt!.syncStatus).toBe("PENDING");
    });
  });
});

// ─── GET /api/workflow/prompts/[id]/versions ──────────────────────────────────

describe("GET /api/workflow/prompts/[id]/versions Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let promptId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a prompt with 2 versions
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkCreate(70);
    const name = uniqueName("VERSIONS_LIST_PROMPT");
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "v1" }),
    );
    const created = (await res.json()).data;
    promptId = created.id;
    createdPromptIds.push(promptId);

    // Add v2
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkUpdate();
    await PUT(
      makeReq(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: "v2" }),
      { params: Promise.resolve({ id: promptId }) },
    );
    // Clear call history from setup so tests start with a clean slate
    mockFetch.mockClear();
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "x@x.com" } } as any);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      authAs(otherUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to fetch version list", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.versions)).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);
      authAs(otherUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when prompt id is missing", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq("http://localhost/api/workflow/prompts//versions", "GET"),
        { params: Promise.resolve({ id: "" }) },
      );
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Version List Retrieval Tests", () => {
    test("returns version list from Hive with correct count", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(2);
      expect(data.data.version_count).toBe(2);
    });

    test("versions are ordered with latest first (desc)", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.versions[0].version_number).toBeGreaterThan(
        data.data.versions[1].version_number,
      );
    });

    test("response includes prompt_id, prompt_name, current_version_id", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveProperty("prompt_id");
      expect(data.data).toHaveProperty("prompt_name");
      expect(data.data).toHaveProperty("current_version_id");
    });

    test("returns 404 for non-existent prompt", async () => {
      authAs(testUser);

      const response = await GET_VERSIONS(
        makeReq("http://localhost/api/workflow/prompts/nonexistent/versions", "GET"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });

    test("GET versions does not call Stakwork (reads from Hive)", async () => {
      authAs(testUser);

      await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions`, "GET"),
        { params: Promise.resolve({ id: promptId }) },
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// ─── GET /api/workflow/prompts/[id]/versions/[versionId] ─────────────────────

describe("GET /api/workflow/prompts/[id]/versions/[versionId] Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  let promptId: string;
  let versionId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // Create a prompt; capture the published version id
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkCreate(80);
    const name = uniqueName("VERSION_DETAIL_PROMPT");
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", {
        name,
        value: "exact v1 value",
        description: "v1 description",
      }),
    );
    const created = (await res.json()).data;
    promptId = created.id;
    versionId = created.published_version_id as string;
    createdPromptIds.push(promptId);
    // Clear call history from setup so tests start with a clean slate
    mockFetch.mockClear();
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "x@x.com" } } as any);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      authAs(otherUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to fetch version detail", async () => {
      authAs(testUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);
      authAs(otherUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when prompt id is missing", async () => {
      authAs(testUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts//versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: "", versionId }) },
      );
      await expectError(response, "Prompt ID is required", 400);
    });

    test("returns 400 when version id is missing", async () => {
      authAs(testUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId: "" }) },
      );
      await expectError(response, "Version ID is required", 400);
    });
  });

  describe("Version Detail Retrieval Tests", () => {
    test("returns full version content from Hive", async () => {
      authAs(testUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.id).toBe(versionId);
      expect(data.data.value).toBe("exact v1 value");
      expect(data.data.description).toBe("v1 description");
      expect(data.data.version_number).toBe(1);
    });

    test("handles version with long prompt value", async () => {
      authAs(testUser);

      // Update to a long value, then read the new version
      mockGetServerSession.mockResolvedValueOnce(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      stakworkOkUpdate();
      const longValue = "A".repeat(5000);
      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}`, "PUT", { value: longValue }),
        { params: Promise.resolve({ id: promptId }) },
      );

      const prompt = await db.prompt.findUnique({ where: { id: promptId } });
      const longVersionId = prompt!.publishedVersionId!;

      authAs(testUser);
      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${longVersionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId: longVersionId }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.data.value).toHaveLength(5000);
    });

    test("returns 404 for non-existent version", async () => {
      authAs(testUser);

      const response = await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/nonexistent`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });

    test("GET version does not call Stakwork (reads from Hive)", async () => {
      authAs(testUser);

      await GET_VERSION_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${promptId}/versions/${versionId}`, "GET"),
        { params: Promise.resolve({ id: promptId, versionId }) },
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// ─── DELETE /api/workflow/prompts/[id] ────────────────────────────────────────

describe("DELETE /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();
    stakworkWorkspace = await createTestWorkspace({ ownerId: testUser.id, slug: "stakwork" });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id } },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });
  });

  afterEach(async () => {
    await cleanupPrompts();
    vi.restoreAllMocks();
  });

  function authAs(user: { id: string; email: string | null }) {
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({ id: user.id, email: user.email ?? "" }),
    );
  }

  async function createPrompt(name: string): Promise<string> {
    mockGetServerSession.mockResolvedValueOnce(
      createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
    );
    stakworkOkCreate(90);
    const res = await POST(
      makeReq("http://localhost/api/workflow/prompts", "POST", { name, value: "to delete" }),
    );
    const created = (await res.json()).data;
    return created.id as string;
  }

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/some-id", "DELETE"),
        { params: Promise.resolve({ id: "some-id" }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/some-id", "DELETE"),
        { params: Promise.resolve({ id: "some-id" }) },
      );
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "x@x.com" } } as any);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/some-id", "DELETE"),
        { params: Promise.resolve({ id: "some-id" }) },
      );
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      authAs(otherUser);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/some-id", "DELETE"),
        { params: Promise.resolve({ id: "some-id" }) },
      );
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to delete prompt", async () => {
      const id = await createPrompt(uniqueName("MEMBER_DELETE_PROMPT"));

      authAs(testUser);
      const response = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${id}`, "DELETE"),
        { params: Promise.resolve({ id }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Prompt should be gone
      const gone = await db.prompt.findUnique({ where: { id } });
      expect(gone).toBeNull();
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      const id = await createPrompt(uniqueName("DEVMODE_DELETE_PROMPT"));

      mockIsDevelopmentMode.mockReturnValue(true);
      authAs(otherUser);

      const response = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${id}`, "DELETE"),
        { params: Promise.resolve({ id }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when id is missing", async () => {
      authAs(testUser);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/", "DELETE"),
        { params: Promise.resolve({ id: "" }) },
      );
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Delete Tests", () => {
    test("successfully deletes prompt and cascades to versions", async () => {
      const id = await createPrompt(uniqueName("CASCADE_DELETE_PROMPT"));

      const versionsBefore = await db.promptVersion.findMany({ where: { promptId: id } });
      expect(versionsBefore).toHaveLength(1);

      authAs(testUser);
      const response = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${id}`, "DELETE"),
        { params: Promise.resolve({ id }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const versionsAfter = await db.promptVersion.findMany({ where: { promptId: id } });
      expect(versionsAfter).toHaveLength(0);

      const promptAfter = await db.prompt.findUnique({ where: { id } });
      expect(promptAfter).toBeNull();
    });

    test("returns 404 for non-existent id", async () => {
      authAs(testUser);

      const response = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/nonexistent", "DELETE"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("Stakwork write-through Tests", () => {
    test("Stakwork delete failure is non-fatal; local delete still succeeds", async () => {
      const id = await createPrompt(uniqueName("STAKWORK_FAIL_DELETE_PROMPT"));

      // Set a stakworkId so the delete push is attempted
      await db.prompt.update({ where: { id }, data: { stakworkId: 90 } });

      authAs(testUser);
      stakworkFail();

      const response = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${id}`, "DELETE"),
        { params: Promise.resolve({ id }) },
      );
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Prompt is still deleted locally
      const gone = await db.prompt.findUnique({ where: { id } });
      expect(gone).toBeNull();
    });

    test("Stakwork delete is called with correct URL when stakworkId is set", async () => {
      const id = await createPrompt(uniqueName("STAKWORK_URL_DELETE_PROMPT"));
      await db.prompt.update({ where: { id }, data: { stakworkId: 91 } });

      authAs(testUser);
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

      await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${id}`, "DELETE"),
        { params: Promise.resolve({ id }) },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/91",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
          }),
        }),
      );
    });
  });
});
