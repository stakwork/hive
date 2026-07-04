/**
 * Integration tests for Hive-native prompt CRUD + write-through sync.
 * These tests operate against the real test database.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID, PUT, PATCH, DELETE } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS, } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import { POST as PUBLISH } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route";
import {
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
    WORKFLOW_GRAPH_PROMPT_STORAGE_ID: "54286",
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

const mockStakworkRequest = vi.fn().mockResolvedValue({ id: 1 });
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: mockStakworkRequest,
  })),
}));

import { isDevelopmentMode } from "@/lib/runtime";
import { config } from "@/config/env";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

// Mock global fetch for Stakwork /prompts push
global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(
  url: string,
  method: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function stakworkOkCreate(id = 42) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { id } }),
  } as Response);
}

function stakworkOkUpdate() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true }),
  } as Response);
}

function stakworkFail() {
  mockFetch.mockRejectedValueOnce(new Error("Stakwork is down"));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

describe("Hive-native Prompt CRUD + Write-through Sync", () => {
  let testUser: { id: string; email: string | null };
  let otherUser: { id: string; email: string | null };
  let stakworkWorkspace: { id: string; slug: string };
  const createdPromptIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockStakworkRequest.mockReset();
    mockStakworkRequest.mockResolvedValue({ id: 1 });
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
    // Clean up created prompts
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

  // ─── Authentication ─────────────────────────────────────────────────────────

  describe("Authentication", () => {
    test("POST returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "UNAUTH_TEST",
        value: "v",
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    test("GET returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/prompts", "GET");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    test("PUT returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/prompts/some-id", "PUT", { value: "v" });
      const res = await PUT(req, { params: Promise.resolve({ id: "some-id" }) });
      expect(res.status).toBe(401);
    });

    test("DELETE returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/prompts/some-id", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "some-id" }) });
      expect(res.status).toBe(401);
    });

    test("PUBLISH returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/publish", "POST");
      const res = await PUBLISH(req, { params: Promise.resolve({ id: "p", versionId: "v" }) });
      expect(res.status).toBe(401);
    });

    test("POST returns 403 when not a stakwork workspace member", async () => {
      authAs(otherUser);
      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "FORBIDDEN_PROMPT",
        value: "val",
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });

  // ─── Create ─────────────────────────────────────────────────────────────────

  describe("Create prompt (POST /api/workflow/prompts)", () => {
    test("creates Hive row + v1 published version; syncs to Stakwork", async () => {
      authAs(testUser);
      stakworkOkCreate(99);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "MY_PROMPT",
        value: "Hello world",
        description: "A test prompt",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.name).toBe("MY_PROMPT");
      expect(data.value).toBe("Hello world");
      expect(data.published_version_id).toBeTruthy();
      createdPromptIds.push(data.id);

      // DB invariant: Prompt.value == published version value
      const prompt = await db.prompt.findUnique({
        where: { id: data.id },
        include: { publishedVersion: true },
      });
      expect(prompt).not.toBeNull();
      expect(prompt!.value).toBe("Hello world");
      expect(prompt!.publishedVersion!.value).toBe("Hello world");
      expect(prompt!.publishedVersion!.published).toBe(true);
      expect(prompt!.publishedVersion!.versionNumber).toBe(1);

      // Stakwork was called with hive_version_id nested inside prompt
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toMatch(/\/prompts\//);
      const body = JSON.parse(opts.body as string);
      expect(body.hive_version_id).toBeUndefined(); // must NOT be top-level
      expect(body.prompt.hive_version_id).toBe(prompt!.publishedVersionId);
      expect(body.prompt.name).toBe("MY_PROMPT");
    });

    test("returns 409 for duplicate name", async () => {
      authAs(testUser);
      stakworkOkCreate(100);

      // First create
      const req1 = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "DUPE_PROMPT",
        value: "v1",
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()).data;
      createdPromptIds.push(data1.id);

      // Second create with same name
      mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(testUser));
      const req2 = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "DUPE_PROMPT",
        value: "v2",
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(409);
    });

    test("returns 400 for invalid name format", async () => {
      authAs(testUser);
      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "invalid-name",
        value: "v",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    test("Stakwork failure → local write succeeds, syncStatus = PENDING", async () => {
      authAs(testUser);
      stakworkFail();

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "PENDING_SYNC_PROMPT",
        value: "pending value",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      const prompt = await db.prompt.findUnique({ where: { id: data.id } });
      expect(prompt!.syncStatus).toBe("PENDING");
    });

    test("write-through payload includes hive_version_id = new PromptVersion.id", async () => {
      authAs(testUser);
      stakworkOkCreate(77);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "VERSION_ID_CHECK",
        value: "check value",
      });
      const res = await POST(req);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      const prompt = await db.prompt.findUnique({
        where: { id: data.id },
        include: { publishedVersion: true },
      });
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(sentBody.hive_version_id).toBeUndefined(); // must NOT be top-level
      expect(sentBody.prompt.hive_version_id).toBe(prompt!.publishedVersionId);
    });
  });

  // ─── Read ────────────────────────────────────────────────────────────────────

  describe("Read prompt (GET /api/workflow/prompts)", () => {
    test("GET list returns prompts from Hive", async () => {
      authAs(testUser);
      stakworkOkCreate(1);

      // Create a prompt first
      mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(testUser));
      const createReq = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "LIST_TEST_PROMPT",
        value: "list value",
      });
      const createRes = await POST(createReq);
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      const req = makeReq("http://localhost/api/workflow/prompts", "GET");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.prompts).toBeInstanceOf(Array);
      const found = body.data.prompts.find((p: { name: string }) => p.name === "LIST_TEST_PROMPT");
      expect(found).toBeTruthy();
    });

    test("GET by id returns prompt from Hive", async () => {
      authAs(testUser);
      stakworkOkCreate(2);

      mockGetServerSession.mockResolvedValueOnce(createAuthenticatedSession(testUser));
      const createReq = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "GET_BY_ID_PROMPT",
        value: "get by id value",
      });
      const createRes = await POST(createReq);
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      const req = makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "GET");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: created.id }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(created.id);
      expect(body.data.name).toBe("GET_BY_ID_PROMPT");
    });

    test("GET by id returns 404 for missing prompt", async () => {
      authAs(testUser);
      const req = makeReq("http://localhost/api/workflow/prompts/nonexistent", "GET");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "nonexistent" }) });
      expect(res.status).toBe(404);
    });
  });

  // ─── Update ──────────────────────────────────────────────────────────────────

  describe("Update prompt (PUT /api/workflow/prompts/[id])", () => {
    test("update creates new UNPUBLISHED draft; Prompt.value and publishedVersionId remain unchanged", async () => {
      // Create
      authAs(testUser);
      stakworkOkCreate(10);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "UPDATE_PROMPT",
          value: "original value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      const originalPublishedVersionId = created.published_version_id as string;

      // Update
      authAs(testUser);
      stakworkOkUpdate();
      const updateRes = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "updated value",
          description: "new desc",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(updateRes.status).toBe(200);
      const updatedData = (await updateRes.json()).data;

      // API response: current_version_id = new draft, published_version_id = original
      expect(updatedData.current_version_id).not.toBe(updatedData.published_version_id);
      expect(updatedData.published_version_id).toBe(originalPublishedVersionId);
      expect(updatedData.value).toBe("updated value"); // shows latest draft value

      // DB: new draft is NOT published; Prompt.value + publishedVersionId unchanged
      const prompt = await db.prompt.findUnique({
        where: { id: created.id },
        include: {
          versions: { orderBy: { versionNumber: "asc" } },
          publishedVersion: true,
        },
      });
      // Prompt.value still mirrors the published version, not the draft
      expect(prompt!.value).toBe("original value");
      expect(prompt!.publishedVersionId).toBe(originalPublishedVersionId);
      expect(prompt!.versions).toHaveLength(2);
      // v2 = draft, unpublished
      expect(prompt!.versions[1].versionNumber).toBe(2);
      expect(prompt!.versions[1].published).toBe(false);
      // v1 = still published
      expect(prompt!.versions[0].published).toBe(true);
      expect(prompt!.publishedVersion!.value).toBe("original value");

      // Stakwork payload uses the new draft version id
      const updateFetchCall = mockFetch.mock.calls[1]; // second call is the PUT
      const sentBody = JSON.parse(updateFetchCall[1].body as string);
      expect(sentBody.hive_version_id).toBeUndefined(); // must NOT be top-level
      expect(sentBody.prompt.hive_version_id).toBe(updatedData.current_version_id);
      expect(sentBody.prompt.hive_version_id).not.toBe(originalPublishedVersionId);
    });

    test("Stakwork update failure → local write succeeds, syncStatus = PENDING", async () => {
      authAs(testUser);
      stakworkOkCreate(11);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "PENDING_UPDATE_PROMPT",
          value: "v1",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      // Mark syncStatus OK first
      await db.prompt.update({ where: { id: created.id }, data: { syncStatus: "OK", stakworkId: 11 } });

      authAs(testUser);
      stakworkFail();
      const updateRes = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(updateRes.status).toBe(200);

      const prompt = await db.prompt.findUnique({ where: { id: created.id } });
      expect(prompt!.syncStatus).toBe("PENDING");
    });
  });

  // ─── Publish version ─────────────────────────────────────────────────────────

  describe("Publish version (POST /api/workflow/prompts/[id]/versions/[versionId]/publish)", () => {
    test("publishing a draft re-aligns current_version_id === published_version_id", async () => {
      // Create (v1, published)
      authAs(testUser);
      stakworkOkCreate(20);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "PUBLISH_DRAFT_VERSION",
          value: "v1 value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      const v1Id = created.published_version_id as string;

      // Update (creates v2 draft, unpublished)
      authAs(testUser);
      stakworkOkUpdate();
      const updateRes = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2 value",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const updatedData = (await updateRes.json()).data;
      const v2Id = updatedData.current_version_id as string;

      // Before publish: current !== published
      expect(updatedData.current_version_id).not.toBe(updatedData.published_version_id);
      expect(updatedData.published_version_id).toBe(v1Id);

      // Verify v1 is still live in DB
      const afterUpdate = await db.prompt.findUnique({ where: { id: created.id } });
      expect(afterUpdate!.value).toBe("v1 value");
      expect(afterUpdate!.publishedVersionId).toBe(v1Id);

      // Publish the draft (v2) as live
      authAs(testUser);
      stakworkOkUpdate(); // best-effort publish push
      const publishRes = await PUBLISH(
        makeReq(`http://localhost/publish`, "POST"),
        { params: Promise.resolve({ id: created.id, versionId: v2Id }) },
      );
      expect(publishRes.status).toBe(200);

      // DB: Prompt.value should now mirror v2; publishedVersionId = v2Id
      const afterPublish = await db.prompt.findUnique({
        where: { id: created.id },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });
      expect(afterPublish!.value).toBe("v2 value");
      expect(afterPublish!.publishedVersionId).toBe(v2Id);

      // current_version_id now equals published_version_id
      expect(afterPublish!.publishedVersionId).toBe(v2Id);

      // v2 is published, v1 is not
      expect(afterPublish!.versions[0].published).toBe(false); // v1
      expect(afterPublish!.versions[1].published).toBe(true);  // v2

      // Stakwork publish push sends { prompt: { hive_version_id } } — no top-level key
      // 3rd fetch call: create + update PUT + publish
      const publishFetchCall = mockFetch.mock.calls[2];
      expect(publishFetchCall).toBeDefined();
      const publishBody = JSON.parse(publishFetchCall[1].body as string);
      expect(publishBody.hive_version_id).toBeUndefined();
      expect(publishBody).toEqual({ prompt: { hive_version_id: v2Id } });
    });

    test("publishing an older version rolls back live value correctly", async () => {
      // Create v1 (published)
      authAs(testUser);
      stakworkOkCreate(21);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "PUBLISH_OLD_VERSION",
          value: "v1 value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      const v1Id = created.published_version_id as string;

      // Update (creates v2 draft)
      authAs(testUser);
      stakworkOkUpdate();
      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2 value",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );

      // Publish v2 (makes v2 live)
      authAs(testUser);
      stakworkOkUpdate();
      const versionsRes = await GET_VERSIONS(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}/versions`, "GET"),
        { params: Promise.resolve({ id: created.id }) },
      );
      const versionsBody = await versionsRes.json();
      const v2Id = versionsBody.data.current_version_id as string;

      mockGetServerSession.mockResolvedValue(
        createAuthenticatedSession({ id: testUser.id, email: testUser.email ?? "" }),
      );
      stakworkOkUpdate();
      await PUBLISH(
        makeReq(`http://localhost/publish`, "POST"),
        { params: Promise.resolve({ id: created.id, versionId: v2Id }) },
      );

      // Now publish v1 (roll back to older version)
      authAs(testUser);
      stakworkOkUpdate();
      const publishRes = await PUBLISH(
        makeReq(`http://localhost/publish`, "POST"),
        { params: Promise.resolve({ id: created.id, versionId: v1Id }) },
      );
      expect(publishRes.status).toBe(200);

      const afterPublish = await db.prompt.findUnique({
        where: { id: created.id },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });
      expect(afterPublish!.value).toBe("v1 value");
      expect(afterPublish!.publishedVersionId).toBe(v1Id);
      expect(afterPublish!.versions[0].published).toBe(true); // v1
      expect(afterPublish!.versions[1].published).toBe(false); // v2
    });

    test("returns 404 if version does not belong to prompt", async () => {
      authAs(testUser);
      const res = await PUBLISH(
        makeReq("http://localhost/publish", "POST"),
        { params: Promise.resolve({ id: "bad-prompt-id", versionId: "bad-version-id" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── Versions list & detail ───────────────────────────────────────────────────

  describe("Version history (GET /api/workflow/prompts/[id]/versions)", () => {
    test("returns all versions for a prompt", async () => {
      authAs(testUser);
      stakworkOkCreate(30);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "VERSION_LIST_PROMPT",
          value: "v1",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      // Add v2
      authAs(testUser);
      stakworkOkUpdate();
      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", { value: "v2" }),
        { params: Promise.resolve({ id: created.id }) },
      );

      authAs(testUser);
      const versionsReq = makeReq(
        `http://localhost/api/workflow/prompts/${created.id}/versions`,
        "GET",
      );
      const versionsRes = await GET_VERSIONS(versionsReq, {
        params: Promise.resolve({ id: created.id }),
      });
      expect(versionsRes.status).toBe(200);
      const versionsBody = await versionsRes.json();
      expect(versionsBody.data.versions).toHaveLength(2);
      expect(versionsBody.data.version_count).toBe(2);
    });

    test("GET single version returns exact value", async () => {
      authAs(testUser);
      stakworkOkCreate(31);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "EXACT_VERSION_PROMPT",
          value: "exact v1 value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      const versionId = created.published_version_id as string;

      authAs(testUser);
      const req = makeReq(
        `http://localhost/api/workflow/prompts/${created.id}/versions/${versionId}`,
        "GET",
      );
      const res = await GET_VERSION_BY_ID(req, {
        params: Promise.resolve({ id: created.id, versionId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.value).toBe("exact v1 value");
      expect(body.data.id).toBe(versionId);
    });
  });

  // ─── Delete ───────────────────────────────────────────────────────────────────

  describe("Delete prompt (DELETE /api/workflow/prompts/[id])", () => {
    test("deletes prompt and cascades to versions", async () => {
      authAs(testUser);
      stakworkOkCreate(40);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "DELETE_PROMPT",
          value: "to delete",
        }),
      );
      const created = (await createRes.json()).data;
      // Don't add to createdPromptIds — will be deleted in the test

      // Verify versions exist
      const versions = await db.promptVersion.findMany({ where: { promptId: created.id } });
      expect(versions).toHaveLength(1);

      authAs(testUser);
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);
      const delRes = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "DELETE"),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(delRes.status).toBe(200);

      // Prompt and versions should be gone
      const promptAfter = await db.prompt.findUnique({ where: { id: created.id } });
      expect(promptAfter).toBeNull();

      const versionsAfter = await db.promptVersion.findMany({ where: { promptId: created.id } });
      expect(versionsAfter).toHaveLength(0);
    });

    test("returns 404 for non-existent prompt", async () => {
      authAs(testUser);
      const res = await DELETE(
        makeReq("http://localhost/api/workflow/prompts/nonexistent", "DELETE"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });

    test("Stakwork delete failure is non-fatal", async () => {
      authAs(testUser);
      stakworkOkCreate(41);
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "DELETE_STAKWORK_FAIL",
          value: "value",
        }),
      );
      const created = (await createRes.json()).data;

      // Set a stakworkId so the delete push is attempted
      await db.prompt.update({
        where: { id: created.id },
        data: { stakworkId: 41 },
      });

      authAs(testUser);
      stakworkFail(); // Stakwork DELETE fails
      const delRes = await DELETE(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "DELETE"),
        { params: Promise.resolve({ id: created.id }) },
      );
      // Local delete should still succeed
      expect(delRes.status).toBe(200);
      const promptAfter = await db.prompt.findUnique({ where: { id: created.id } });
      expect(promptAfter).toBeNull();
    });
  });

  // ─── agentNames ──────────────────────────────────────────────────────────────

  describe("agentNames field", () => {
    test("create with agentNames → persisted and returned in response", async () => {
      authAs(testUser);
      stakworkOkCreate(200);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_CREATE",
        value: "v1",
        agentNames: ["repo-agent", "chat-agent"],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      expect(data.agent_names).toEqual(["repo-agent", "chat-agent"]);

      const prompt = await db.prompt.findUnique({ where: { id: data.id } });
      expect(prompt!.agentNames).toEqual(["repo-agent", "chat-agent"]);
    });

    test("existing prompts (no agentNames supplied) default to empty array", async () => {
      authAs(testUser);
      stakworkOkCreate(201);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_EMPTY",
        value: "v1",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      expect(data.agent_names).toEqual([]);
    });

    test("update preserves / updates agentNames on Prompt row across draft versions", async () => {
      authAs(testUser);
      stakworkOkCreate(202);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "AGENT_NAMES_UPDATE",
          value: "v1",
          agentNames: ["canvas-agent"],
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      stakworkOkUpdate();
      const updateRes = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2",
          agentNames: ["canvas-agent", "coding-agent"],
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(updateRes.status).toBe(200);
      const updatedData = (await updateRes.json()).data;

      const prompt = await db.prompt.findUnique({
        where: { id: created.id },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });
      expect(prompt!.versions).toHaveLength(2);
      expect(prompt!.agentNames).toEqual(["canvas-agent", "coding-agent"]);

      authAs(testUser);
      const getRes = await GET_BY_ID(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "GET"),
        { params: Promise.resolve({ id: created.id }) },
      );
      const getData = (await getRes.json()).data;
      expect(getData.agent_names).toEqual(["canvas-agent", "coding-agent"]);

      const updateFetchCall = mockFetch.mock.calls[1];
      const sentBody = JSON.parse(updateFetchCall[1].body as string);
      expect(sentBody.prompt.agentNames).toBeUndefined();
      expect(sentBody.prompt.agent_names).toBeUndefined();
      expect((updatedData as Record<string, unknown>).agentNames).toBeUndefined();
    });

    test("update without agentNames does not erase existing agentNames", async () => {
      authAs(testUser);
      stakworkOkCreate(203);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "AGENT_NAMES_PRESERVE",
          value: "v1",
          agentNames: ["plan-agent"],
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      stakworkOkUpdate();
      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );

      const prompt = await db.prompt.findUnique({ where: { id: created.id } });
      expect(prompt!.agentNames).toEqual(["plan-agent"]);
    });

    test("server-side: blank entries are stripped from agentNames", async () => {
      authAs(testUser);
      stakworkOkCreate(204);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_BLANK",
        value: "v1",
        agentNames: ["repo-agent", "  ", "", "chat-agent"],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      expect(data.agent_names).toEqual(["repo-agent", "chat-agent"]);
    });

    test("server-side: duplicate entries are de-duped in agentNames", async () => {
      authAs(testUser);
      stakworkOkCreate(205);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_DEDUPE",
        value: "v1",
        agentNames: ["repo-agent", "repo-agent", "chat-agent"],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      expect(data.agent_names).toEqual(["repo-agent", "chat-agent"]);
    });

    test("server-side: unknown agent name is rejected with 400", async () => {
      authAs(testUser);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_INVALID",
        value: "v1",
        agentNames: ["not-a-real-agent"],
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid agent name/);
    });

    test("Stakwork push payload does NOT include agentNames on create", async () => {
      authAs(testUser);
      stakworkOkCreate(206);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "AGENT_NAMES_PAYLOAD_CHECK",
        value: "v1",
        agentNames: ["build-agent"],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      const [, opts] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body as string);
      expect(sentBody.agentNames).toBeUndefined();
      expect(sentBody.agent_names).toBeUndefined();
      expect(sentBody.prompt.agentNames).toBeUndefined();
      expect(sentBody.prompt.agent_names).toBeUndefined();
    });
  });

  // ─── PATCH agentNames (decoupled from version/publish lifecycle) ──────────────

  describe("PATCH agentNames (no new version, no publish)", () => {
    test("PATCH updates agentNames without creating a new version", async () => {
      authAs(testUser);
      stakworkOkCreate(210);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "AGENT_NAMES_PATCH",
          value: "v1",
          agentNames: ["repo-agent"],
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      const fetchCallsBefore = mockFetch.mock.calls.length;

      authAs(testUser);
      const patchRes = await PATCH(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PATCH", {
          agentNames: ["repo-agent", "chat-agent"],
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(patchRes.status).toBe(200);
      const patchData = (await patchRes.json()).data;
      expect(patchData.agent_names).toEqual(["repo-agent", "chat-agent"]);

      const prompt = await db.prompt.findUnique({
        where: { id: created.id },
        include: { versions: true },
      });
      // No new version created — still just the initial published version.
      expect(prompt!.versions).toHaveLength(1);
      expect(prompt!.agentNames).toEqual(["repo-agent", "chat-agent"]);
      // Published pointer unchanged (still the original published version).
      expect(prompt!.publishedVersionId).toBe(created.published_version_id);
      // No Stakwork push for a metadata-only PATCH.
      expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
    });

    test("PATCH validates agent names and rejects unknown ones with 400", async () => {
      authAs(testUser);
      stakworkOkCreate(211);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "AGENT_NAMES_PATCH_INVALID",
          value: "v1",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      const patchRes = await PATCH(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PATCH", {
          agentNames: ["not-a-real-agent"],
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(patchRes.status).toBe(400);
      const body = await patchRes.json();
      expect(body.error).toMatch(/Invalid agent name/);
    });

    test("PATCH returns 400 when agentNames is omitted", async () => {
      authAs(testUser);
      stakworkOkCreate(212);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "AGENT_NAMES_PATCH_MISSING",
          value: "v1",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);

      authAs(testUser);
      const patchRes = await PATCH(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PATCH", {}),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(patchRes.status).toBe(400);
    });
  });

  // ─── Prompt Graph Recorder ───────────────────────────────────────────────────

  describe("Prompt graph recorder (recordPromptOnGraph)", () => {
    test("create: launches graph-recorder workflow with correct payload shape", async () => {
      authAs(testUser);
      stakworkOkCreate(50);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "GRAPH_RECORDER_CREATE",
        value: "initial value",
        description: "graph recorder test",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      // Find the graph-recorder call (stakworkRequest for /projects)
      const graphCall = mockStakworkRequest.mock.calls.find(
        ([endpoint]: [string]) => endpoint === "/projects",
      );
      expect(graphCall).toBeDefined();
      const [, payload] = graphCall as [string, Record<string, unknown>];

      expect(payload.workflow_id).toBe(54286);
      expect(payload.name).toBe(`Prompt Graph Recorder ${data.id}`);

      const vars = (payload as { workflow_params: { set_var: { attributes: { vars: { prompt: Record<string, unknown> } } } } })
        .workflow_params.set_var.attributes.vars.prompt;

      expect(vars.id).toBe(data.id);
      expect(vars.prompt_id).toBe(data.id);
      expect(vars.prompt_version_id).toBe(data.published_version_id);
      expect(vars.name).toBe("GRAPH_RECORDER_CREATE");
      expect(vars.description).toBe("graph recorder test");
      expect(vars.value).toBe("initial value");
      expect(vars.customer_id).toBeNull();
    });

    test("update (save): does NOT launch graph-recorder (draft must not be recorded as live)", async () => {
      authAs(testUser);
      stakworkOkCreate(51);

      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "GRAPH_RECORDER_UPDATE",
          value: "v1 value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      // Clear graph-recorder calls from the create step
      mockStakworkRequest.mockClear();

      authAs(testUser);
      stakworkOkUpdate();

      const putRes = await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2 value",
          description: "updated desc",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(putRes.status).toBe(200);

      // Graph recorder must NOT have been called on a plain save
      const graphCall = mockStakworkRequest.mock.calls.find(
        ([endpoint]: [string]) => endpoint === "/projects",
      );
      expect(graphCall).toBeUndefined();
    });

    test("publish: launches graph-recorder with published version id and value", async () => {
      authAs(testUser);
      stakworkOkCreate(52);

      // Create with v1
      const createRes = await POST(
        makeReq("http://localhost/api/workflow/prompts", "POST", {
          name: "GRAPH_RECORDER_PUBLISH",
          value: "v1 value",
        }),
      );
      const created = (await createRes.json()).data;
      createdPromptIds.push(created.id);
      const v1Id = created.published_version_id as string;

      // Add v2
      authAs(testUser);
      stakworkOkUpdate();
      mockStakworkRequest.mockClear();
      await PUT(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}`, "PUT", {
          value: "v2 value",
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      mockStakworkRequest.mockClear();

      // Publish v1 (roll back)
      authAs(testUser);
      const publishRes = await PUBLISH(
        makeReq(`http://localhost/api/workflow/prompts/${created.id}/versions/${v1Id}/publish`, "POST"),
        { params: Promise.resolve({ id: created.id, versionId: v1Id }) },
      );
      expect(publishRes.status).toBe(200);

      const graphCall = mockStakworkRequest.mock.calls.find(
        ([endpoint]: [string]) => endpoint === "/projects",
      );
      expect(graphCall).toBeDefined();
      const [, payload] = graphCall as [string, Record<string, unknown>];

      const vars = (payload as { workflow_params: { set_var: { attributes: { vars: { prompt: Record<string, unknown> } } } } })
        .workflow_params.set_var.attributes.vars.prompt;

      expect(vars.prompt_version_id).toBe(v1Id);
      expect(vars.value).toBe("v1 value");
      expect(vars.id).toBe(created.id);
      expect(vars.customer_id).toBeNull();
    });

    test("unset env var: graph recorder is skipped, operation still succeeds", async () => {
      // Override config to remove the workflow id (cast to bypass as const)
      const mutableConfig = config as Record<string, unknown>;
      const original = mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
      mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = undefined;

      authAs(testUser);
      stakworkOkCreate(53);

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "GRAPH_RECORDER_NO_ENV",
        value: "some value",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      // No /projects call should have been made
      const graphCall = mockStakworkRequest.mock.calls.find(
        ([endpoint]: [string]) => endpoint === "/projects",
      );
      expect(graphCall).toBeUndefined();

      // Restore
      mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = original;
    });

    test("stakworkRequest throws: error is swallowed, operation still succeeds", async () => {
      authAs(testUser);
      stakworkOkCreate(54);

      // Graph recorder request will throw
      mockStakworkRequest.mockRejectedValueOnce(new Error("Graph recorder network error"));

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "GRAPH_RECORDER_THROW",
        value: "value",
      });
      const res = await POST(req);
      // Must still succeed despite graph recorder throwing
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.name).toBe("GRAPH_RECORDER_THROW");
      expect(data.id).toBeTruthy();
      createdPromptIds.push(data.id);
    });

    test("graph recorder fires even when /prompts push fails", async () => {
      authAs(testUser);
      // Simulate /prompts push failure
      stakworkFail();

      // Graph recorder will still succeed
      mockStakworkRequest.mockResolvedValue({ id: 1 });

      const req = makeReq("http://localhost/api/workflow/prompts", "POST", {
        name: "GRAPH_RECORDER_INDEPENDENT",
        value: "value",
      });
      const res = await POST(req);
      // Local write succeeds (syncStatus=PENDING)
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      createdPromptIds.push(data.id);

      // Graph recorder call must still have fired
      const graphCall = mockStakworkRequest.mock.calls.find(
        ([endpoint]: [string]) => endpoint === "/projects",
      );
      expect(graphCall).toBeDefined();
    });
  });
});
