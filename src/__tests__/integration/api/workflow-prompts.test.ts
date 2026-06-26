/**
 * Integration tests for Hive-native prompt CRUD routes.
 *
 * These routes now read/write directly from the Hive DB (no Stakwork proxy).
 * Authorization is workspace-scoped: the caller must be a member/owner of
 * the workspace that owns the prompt.
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
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Suppress encryption errors for workspaces that have no real key stored
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: () => { throw new Error("no key"); },
    }),
  },
}));

const mockGetServerSession = getMockedSession();

// Keep fetch as a spy; most tests don't need real Stakwork calls — the write-
// through is best-effort and the local DB write always wins.
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ data: { id: 1 } }),
  text: async () => "",
} as Response);
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

// ─── shared helpers ───────────────────────────────────────────────────────────

function session(userId: string, email = `${userId}@test.com`) {
  return { user: { id: userId, email }, expires: "9999" };
}

function req(method: string, url: string, body?: unknown): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return new NextRequest(url, { method });
}

// ─── test state ───────────────────────────────────────────────────────────────

let testUser: { id: string; email: string; name: string };
let workspace: { id: string; slug: string };
let otherUser: { id: string; email: string; name: string };
let otherWorkspace: { id: string; slug: string };

beforeEach(async () => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 1 } }),
    text: async () => "",
  } as Response);

  testUser = await createTestUser();
  otherUser = await createTestUser();
  workspace = await createTestWorkspace({ ownerId: testUser.id });
  otherWorkspace = await createTestWorkspace({ ownerId: otherUser.id });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/workflow/prompts
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/workflow/prompts", () => {
  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "FOO", value: "v", workspace_slug: workspace.slug }));
      await expectUnauthorized(res);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "FOO", value: "v", workspace_slug: workspace.slug }));
      await expectUnauthorized(res);
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user is not a member of the workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "FOO", value: "v", workspace_slug: workspace.slug }));
      await expectForbidden(res);
    });

    test("allows workspace owner to create a prompt", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(testUser.id));
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "OWNER_PROMPT", value: "owner value", workspace_slug: workspace.slug }));
      const data = await expectSuccess(res, 201);
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("OWNER_PROMPT");
    });

    test("allows workspace member (DEVELOPER) to create a prompt", async () => {
      const member = await createTestUser();
      await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id, role: "DEVELOPER" } });
      mockGetServerSession.mockResolvedValueOnce(session(member.id));
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "DEV_PROMPT", value: "dev value", workspace_slug: workspace.slug }));
      const data = await expectSuccess(res, 201);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 400 when name is missing", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { value: "v", workspace_slug: workspace.slug }));
      await expectError(res, "name and value are required", 400);
    });

    test("returns 400 when value is missing", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "PROMPT", workspace_slug: workspace.slug }));
      await expectError(res, "name and value are required", 400);
    });

    test("returns 400 when workspace_slug is missing", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "PROMPT", value: "v" }));
      await expectError(res, "workspace_slug is required", 400);
    });

    test("returns 400 when name contains lowercase letters", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "invalid_name", value: "v", workspace_slug: workspace.slug }));
      await expectError(res, "must match", 400);
    });

    test("returns 400 when name contains hyphens", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "TEST-NAME", value: "v", workspace_slug: workspace.slug }));
      await expectError(res, "must match", 400);
    });

    test("accepts valid UPPERCASE_UNDERSCORE name with digits", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "VALID_NAME_2", value: "v", workspace_slug: workspace.slug }));
      const data = await expectSuccess(res, 201);
      expect(data.data.name).toBe("VALID_NAME_2");
    });

    test("returns 409 on duplicate name within same workspace", async () => {
      await POST(req("POST", "http://h/api/workflow/prompts", { name: "DUPE", value: "v1", workspace_slug: workspace.slug }));
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "DUPE", value: "v2", workspace_slug: workspace.slug }));
      expect(res.status).toBe(409);
    });
  });

  describe("Create behaviour", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("persists prompt and returns correct shape", async () => {
      const res = await POST(req("POST", "http://h/api/workflow/prompts", {
        name: "MY_PROMPT",
        value: "hello world",
        description: "a description",
        workspace_slug: workspace.slug,
      }));
      const data = await expectSuccess(res, 201);
      expect(data.data.name).toBe("MY_PROMPT");
      expect(data.data.value).toBe("hello world");
      expect(data.data.description).toBe("a description");
      expect(data.data.current_version_id).toBeTruthy();

      const inDb = await db.prompt.findUnique({ where: { workspaceId_name: { workspaceId: workspace.id, name: "MY_PROMPT" } } });
      expect(inDb).toBeTruthy();
    });

    test("handles very long prompt values", async () => {
      const longValue = "A".repeat(10000);
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "LONG_PROMPT", value: longValue, workspace_slug: workspace.slug }));
      const data = await expectSuccess(res, 201);
      expect(data.data.value).toBe(longValue);
    });

    test("handles malformed JSON body with 500", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(testUser.id));
      const r = new NextRequest("http://h/api/workflow/prompts", { method: "POST", body: "invalid{json", headers: { "Content-Type": "application/json" } });
      const res = await POST(r);
      expect(res.status).toBe(500);
    });

    test("Stakwork write-through failure does not prevent local creation", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network failure"));
      const res = await POST(req("POST", "http://h/api/workflow/prompts", { name: "SYNC_FAIL", value: "v", workspace_slug: workspace.slug }));
      const data = await expectSuccess(res, 201);
      expect(data.data.name).toBe("SYNC_FAIL");
      const inDb = await db.prompt.findUnique({ where: { workspaceId_name: { workspaceId: workspace.id, name: "SYNC_FAIL" } } });
      expect(inDb?.syncStatus).toBe("PENDING");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/workflow/prompts
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/workflow/prompts", () => {
  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      await expectUnauthorized(res);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      await expectUnauthorized(res);
    });
  });

  describe("Authorization", () => {
    test("returns 403 when workspace_slug is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(testUser.id));
      const res = await GET(req("GET", "http://h/api/workflow/prompts"));
      expect(res.status).toBe(400);
    });

    test("returns 403 when user is not a member of the workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      await expectForbidden(res);
    });

    test("allows workspace owner to list prompts", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(testUser.id));
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.prompts)).toBe(true);
    });
  });

  describe("Listing and pagination", () => {
    beforeEach(async () => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
      // Seed 3 prompts
      for (const name of ["ALPHA", "BETA", "GAMMA"]) {
        const p = await db.prompt.create({ data: { name, value: `val-${name}`, workspaceId: workspace.id } });
        const v = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: `val-${name}`, published: true } });
        await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v.id } });
      }
    });

    test("returns all prompts for the workspace", async () => {
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      const data = await expectSuccess(res, 200);
      expect(data.data.total).toBe(3);
      expect(data.data.prompts).toHaveLength(3);
    });

    test("respects page and size params", async () => {
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}&page=1&size=2`));
      const data = await expectSuccess(res, 200);
      expect(data.data.prompts).toHaveLength(2);
      expect(data.data.page).toBe(1);
      expect(data.data.size).toBe(2);
      expect(data.data.total).toBe(3);
    });

    test("second page returns remaining items", async () => {
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}&page=2&size=2`));
      const data = await expectSuccess(res, 200);
      expect(data.data.prompts).toHaveLength(1);
      expect(data.data.page).toBe(2);
    });

    test("search filters by name (case-insensitive)", async () => {
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}&search=alpha`));
      const data = await expectSuccess(res, 200);
      expect(data.data.total).toBe(1);
      expect(data.data.prompts[0].name).toBe("ALPHA");
    });

    test("does not return prompts from other workspaces", async () => {
      // Add prompt to other workspace
      await db.prompt.create({ data: { name: "OTHER", value: "v", workspaceId: otherWorkspace.id } });
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}`));
      const data = await expectSuccess(res, 200);
      expect(data.data.prompts.every((p: { name: string }) => p.name !== "OTHER")).toBe(true);
    });

    test("returns correct response shape fields", async () => {
      const res = await GET(req("GET", `http://h/api/workflow/prompts?workspace_slug=${workspace.slug}&size=1`));
      const data = await expectSuccess(res, 200);
      const p = data.data.prompts[0];
      expect(p).toHaveProperty("id");
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("value");
      expect(p).toHaveProperty("current_version_id");
      expect(p).toHaveProperty("version_count");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/workflow/prompts/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/workflow/prompts/[id]", () => {
  let promptId: string;

  beforeEach(async () => {
    const p = await db.prompt.create({ data: { name: "FETCH_ME", value: "fetch value", workspaceId: workspace.id } });
    const v = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: "fetch value", published: true } });
    await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v.id } });
    promptId = p.id;
  });

  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await GET_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });
  });

  describe("Authorization / IDOR", () => {
    test("returns 404 for prompt in another workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await GET_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Retrieval", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 404 for non-existent id", async () => {
      const res = await GET_BY_ID(req("GET", "http://h/api/workflow/prompts/does-not-exist"), { params: Promise.resolve({ id: "does-not-exist" }) });
      expect(res.status).toBe(404);
    });

    test("successfully retrieves prompt by id with correct shape", async () => {
      const res = await GET_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(promptId);
      expect(data.data.name).toBe("FETCH_ME");
      expect(data.data.value).toBe("fetch value");
      expect(data.data).toHaveProperty("current_version_id");
      expect(data.data).toHaveProperty("version_count");
    });

    test("workspace member can also retrieve the prompt", async () => {
      const member = await createTestUser();
      await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id, role: "DEVELOPER" } });
      mockGetServerSession.mockResolvedValueOnce(session(member.id));
      const res = await GET_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.data.id).toBe(promptId);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/workflow/prompts/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe("PUT /api/workflow/prompts/[id]", () => {
  let promptId: string;

  beforeEach(async () => {
    const p = await db.prompt.create({ data: { name: "UPDATE_ME", value: "original", workspaceId: workspace.id } });
    const v = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: "original", published: true } });
    await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v.id } });
    promptId = p.id;
  });

  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "new" }), { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });
  });

  describe("Authorization / IDOR", () => {
    test("returns 404 for prompt in another workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "new" }), { params: Promise.resolve({ id: promptId }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Validation", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 400 when value is missing", async () => {
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, {}), { params: Promise.resolve({ id: promptId }) });
      await expectError(res, "value is required", 400);
    });

    test("returns 404 for non-existent id", async () => {
      const res = await PUT(req("PUT", "http://h/api/workflow/prompts/no-such-id", { value: "v" }), { params: Promise.resolve({ id: "no-such-id" }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Update behaviour", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("successfully updates prompt value and creates new version", async () => {
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "updated value" }), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
      expect(data.data.value).toBe("updated value");
      expect(data.data.version_count).toBe(2);
    });

    test("updates prompt with optional description", async () => {
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "new value", description: "new desc" }), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.data.description).toBe("new desc");
    });

    test("Stakwork write-through failure does not prevent local update", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network"));
      const res = await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "new" }), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.data.value).toBe("new");
      const inDb = await db.prompt.findUnique({ where: { id: promptId } });
      expect(inDb?.syncStatus).toBe("PENDING");
    });

    test("live value mirrors the new (published) version", async () => {
      await PUT(req("PUT", `http://h/api/workflow/prompts/${promptId}`, { value: "v2" }), { params: Promise.resolve({ id: promptId }) });
      const inDb = await db.prompt.findUnique({ where: { id: promptId }, include: { publishedVersion: true } });
      expect(inDb?.value).toBe("v2");
      expect(inDb?.publishedVersion?.value).toBe("v2");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/workflow/prompts/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/workflow/prompts/[id]", () => {
  let promptId: string;

  beforeEach(async () => {
    const p = await db.prompt.create({ data: { name: "DELETE_ME", value: "bye", workspaceId: workspace.id } });
    promptId = p.id;
  });

  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await DELETE(req("DELETE", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });
  });

  describe("Authorization / IDOR", () => {
    test("returns 404 and does NOT delete prompt in another workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await DELETE(req("DELETE", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      expect(res.status).toBe(404);
      const still = await db.prompt.findUnique({ where: { id: promptId } });
      expect(still).toBeTruthy();
    });
  });

  describe("Delete behaviour", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 404 for non-existent id", async () => {
      const res = await DELETE(req("DELETE", "http://h/api/workflow/prompts/no-such-id"), { params: Promise.resolve({ id: "no-such-id" }) });
      expect(res.status).toBe(404);
    });

    test("successfully deletes prompt and cascade-removes versions", async () => {
      const v = await db.promptVersion.create({ data: { promptId, versionNumber: 1, value: "bye", published: true } });
      await db.prompt.update({ where: { id: promptId }, data: { publishedVersionId: v.id } });

      const res = await DELETE(req("DELETE", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);

      const gone = await db.prompt.findUnique({ where: { id: promptId } });
      expect(gone).toBeNull();
      const versionsGone = await db.promptVersion.findMany({ where: { promptId } });
      expect(versionsGone).toHaveLength(0);
    });

    test("workspace member can delete a prompt", async () => {
      const member = await createTestUser();
      await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id, role: "DEVELOPER" } });
      mockGetServerSession.mockResolvedValueOnce(session(member.id));
      const res = await DELETE(req("DELETE", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
    });

    test("best-effort Stakwork delete does not block on failure", async () => {
      // Give the prompt a stakworkId so delete-through is attempted
      await db.prompt.update({ where: { id: promptId }, data: { stakworkId: 99 } });
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      const res = await DELETE(req("DELETE", `http://h/api/workflow/prompts/${promptId}`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/workflow/prompts/[id]/versions
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/workflow/prompts/[id]/versions", () => {
  let promptId: string;
  let v1id: string;
  let v2id: string;

  beforeEach(async () => {
    const p = await db.prompt.create({ data: { name: "VERSIONED", value: "v2", workspaceId: workspace.id } });
    const v1 = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: "v1", published: false, whodunnit: "user-a" } });
    const v2 = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 2, value: "v2", published: true, whodunnit: null } });
    await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v2.id } });
    promptId = p.id;
    v1id = v1.id;
    v2id = v2.id;
  });

  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      await expectUnauthorized(res);
    });
  });

  describe("Authorization / IDOR", () => {
    test("returns 404 for prompt in another workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Version listing", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 404 for non-existent prompt id", async () => {
      const res = await GET_VERSIONS(req("GET", "http://h/api/workflow/prompts/no-id/versions"), { params: Promise.resolve({ id: "no-id" }) });
      expect(res.status).toBe(404);
    });

    test("returns version list with correct shape in desc order", async () => {
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(2);
      // Desc order: v2 first
      expect(data.data.versions[0].version_number).toBe(2);
      expect(data.data.versions[1].version_number).toBe(1);
      expect(data.data.version_count).toBe(2);
      expect(data.data.prompt_name).toBe("VERSIONED");
    });

    test("includes published flag per version", async () => {
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      const published = data.data.versions.find((v: { id: string }) => v.id === v2id);
      const unpublished = data.data.versions.find((v: { id: string }) => v.id === v1id);
      expect(published?.published).toBe(true);
      expect(unpublished?.published).toBe(false);
    });

    test("handles null whodunnit correctly", async () => {
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      const v2 = data.data.versions.find((v: { id: string }) => v.id === v2id);
      expect(v2?.whodunnit).toBeNull();
    });

    test("current_version_id reflects the published version", async () => {
      const res = await GET_VERSIONS(req("GET", `http://h/api/workflow/prompts/${promptId}/versions`), { params: Promise.resolve({ id: promptId }) });
      const data = await expectSuccess(res, 200);
      expect(data.data.current_version_id).toBe(v2id);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/workflow/prompts/[id]/versions/[versionId]
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/workflow/prompts/[id]/versions/[versionId]", () => {
  let promptId: string;
  let v1id: string;
  let v2id: string;

  beforeEach(async () => {
    const p = await db.prompt.create({ data: { name: "DETAIL_PROMPT", value: "v2 text", workspaceId: workspace.id } });
    const v1 = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: "exact v1 content for replay", published: false, whodunnit: "alice" } });
    const v2 = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 2, value: "v2 text", published: true } });
    await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v2.id } });
    promptId = p.id;
    v1id = v1.id;
    v2id = v2.id;
  });

  describe("Authentication", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${v1id}`), { params: Promise.resolve({ id: promptId, versionId: v1id }) });
      await expectUnauthorized(res);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${v1id}`), { params: Promise.resolve({ id: promptId, versionId: v1id }) });
      await expectUnauthorized(res);
    });
  });

  describe("Authorization / IDOR", () => {
    test("returns 404 for version in another workspace's prompt", async () => {
      mockGetServerSession.mockResolvedValueOnce(session(otherUser.id));
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${v1id}`), { params: Promise.resolve({ id: promptId, versionId: v1id }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Version detail retrieval", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(session(testUser.id));
    });

    test("returns 404 for non-existent version id", async () => {
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/no-ver`), { params: Promise.resolve({ id: promptId, versionId: "no-ver" }) });
      expect(res.status).toBe(404);
    });

    test("returns 404 when versionId belongs to a different prompt", async () => {
      const other = await db.prompt.create({ data: { name: "OTHER_PROMPT", value: "o", workspaceId: workspace.id } });
      const ov = await db.promptVersion.create({ data: { promptId: other.id, versionNumber: 1, value: "o", published: true } });
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${ov.id}`), { params: Promise.resolve({ id: promptId, versionId: ov.id }) });
      expect(res.status).toBe(404);
    });

    test("returns exact verbatim value of a prior version (eval replay)", async () => {
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${v1id}`), { params: Promise.resolve({ id: promptId, versionId: v1id }) });
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
      expect(data.data.value).toBe("exact v1 content for replay");
      expect(data.data.version_number).toBe(1);
      expect(data.data.name).toBe("DETAIL_PROMPT");
      expect(data.data.whodunnit).toBe("alice");
    });

    test("returns correct shape fields", async () => {
      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${promptId}/versions/${v2id}`), { params: Promise.resolve({ id: promptId, versionId: v2id }) });
      const data = await expectSuccess(res, 200);
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("prompt_id");
      expect(data.data).toHaveProperty("version_number");
      expect(data.data).toHaveProperty("name");
      expect(data.data).toHaveProperty("value");
      expect(data.data).toHaveProperty("published");
      expect(data.data).toHaveProperty("created_at");
    });

    test("handles version with very long value", async () => {
      const longValue = "B".repeat(5000);
      const p2 = await db.prompt.create({ data: { name: "LONG_V", value: longValue, workspaceId: workspace.id } });
      const lv = await db.promptVersion.create({ data: { promptId: p2.id, versionNumber: 1, value: longValue, published: true } });
      await db.prompt.update({ where: { id: p2.id }, data: { publishedVersionId: lv.id } });

      const res = await GET_VERSION_BY_ID(req("GET", `http://h/api/workflow/prompts/${p2.id}/versions/${lv.id}`), { params: Promise.resolve({ id: p2.id, versionId: lv.id }) });
      const data = await expectSuccess(res, 200);
      expect(data.data.value).toHaveLength(5000);
    });
  });
});
