/**
 * Integration tests for Hive-native Prompt/PromptVersion data models.
 *
 * Covers:
 *  - Read-through miss → prompt persisted in Hive, returned
 *  - Local-wins invariant → Stakwork GET called exactly once across two reads
 *  - Write-through Stakwork failure → local write succeeds, syncStatus=PENDING
 *  - Exact prior-version fetch → version 2's value returned verbatim
 *  - Live=published transactional rule → publishing an OLDER version sets
 *    Prompt.value to that version's text, publishedVersionId to it, other
 *    versions published=false
 *  - IDOR → routes called with a workspace the user doesn't belong to return 403/404
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { PromptSyncStatus } from "@prisma/client";
import {
  getPromptReadThrough,
  seedWorkspacePromptsFromStakwork,
  writePromptThrough,
  publishVersion,
  PromptNotFoundError,
  PromptNameInvalidError,
  PromptConflictError,
} from "@/services/prompts/prompt-sync";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_DETAIL } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import { POST as PUBLISH } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route";
import { getServerSession } from "next-auth/next";

vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("next-auth/next");

const mockGetServerSession = vi.mocked(getServerSession);

// ── helpers ────────────────────────────────────────────────────────────────────

function makeSession(userId: string) {
  return { user: { id: userId, email: `${userId}@test.com` }, expires: "9999" };
}

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return new NextRequest(url, { method });
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let testUser: { id: string };
let workspace: { id: string; slug: string };
let otherUser: { id: string };
let otherWorkspace: { id: string; slug: string };

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset global fetch to a spy that rejects by default (no real HTTP)
  global.fetch = vi.fn().mockRejectedValue(new Error("fetch not mocked"));

  testUser = await createTestUser({ email: `user-${Date.now()}@test.com` });
  workspace = await createTestWorkspace({ ownerId: testUser.id, slug: `ws-${Date.now()}` });
  otherUser = await createTestUser({ email: `other-${Date.now()}@test.com` });
  otherWorkspace = await createTestWorkspace({ ownerId: otherUser.id, slug: `other-ws-${Date.now()}` });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Service-layer tests (no HTTP, directly calling sync service)
// ─────────────────────────────────────────────────────────────────────────────

describe("getPromptReadThrough", () => {
  it("returns existing Hive prompt without calling Stakwork", async () => {
    // Pre-create prompt in Hive
    const prompt = await db.prompt.create({
      data: { name: "MY_PROMPT", value: "hello", workspaceId: workspace.id },
    });
    const version = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "hello", published: true, whodunnit: "test" },
    });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: version.id } });

    const result = await getPromptReadThrough("MY_PROMPT", workspace.id);

    expect(result.id).toBe(prompt.id);
    expect(result.name).toBe("MY_PROMPT");
    // fetch should NOT have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches from Stakwork on miss and persists as Hive v1", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Mock: list endpoint returns our prompt
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { prompts: [{ id: 42, name: "NEW_PROMPT" }] } }),
      } as Response)
      // Mock: detail endpoint
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 42, name: "NEW_PROMPT", value: "The prompt value from Stakwork", description: "desc" },
        }),
      } as Response);

    const result = await getPromptReadThrough("NEW_PROMPT", workspace.id);

    expect(result.name).toBe("NEW_PROMPT");
    expect(result.value).toBe("The prompt value from Stakwork");
    expect(result.stakworkId).toBe(42);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].versionNumber).toBe(1);
    expect(result.versions[0].published).toBe(true);
    expect(result.publishedVersionId).toBe(result.versions[0].id);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Persisted in DB
    const persisted = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId: workspace.id, name: "NEW_PROMPT" } },
    });
    expect(persisted).toBeTruthy();
  });

  it("local-wins: Stakwork only called once across two reads", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { prompts: [{ id: 55, name: "CACHED_PROMPT" }] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 55, name: "CACHED_PROMPT", value: "cached value" },
        }),
      } as Response);

    await getPromptReadThrough("CACHED_PROMPT", workspace.id);
    // second call — should NOT hit Stakwork again
    const second = await getPromptReadThrough("CACHED_PROMPT", workspace.id);

    expect(second.name).toBe("CACHED_PROMPT");
    expect(mockFetch).toHaveBeenCalledTimes(2); // only the initial 2 calls
  });

  it("throws PromptNotFoundError when Stakwork returns 404", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await expect(getPromptReadThrough("MISSING", workspace.id)).rejects.toThrow(PromptNotFoundError);
  });

  it("throws PromptNotFoundError when prompt not in Stakwork list", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { prompts: [] } }),
    } as Response);

    await expect(getPromptReadThrough("MISSING", workspace.id)).rejects.toThrow(PromptNotFoundError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. writePromptThrough
// ─────────────────────────────────────────────────────────────────────────────

describe("writePromptThrough", () => {
  it("creates a new prompt + version, syncStatus=OK on Stakwork success", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: 99 } }),
    } as Response);

    const result = await writePromptThrough({
      name: "NEW_PROMPT",
      value: "some value",
      description: "desc",
      workspaceId: workspace.id,
      userId: testUser.id,
    });

    expect(result.name).toBe("NEW_PROMPT");
    expect(result.value).toBe("some value");
    expect(result.syncStatus).toBe(PromptSyncStatus.OK);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].published).toBe(true);
    expect(result.publishedVersionId).toBe(result.versions[0].id);
  });

  it("local write succeeds + syncStatus=PENDING when Stakwork push fails", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const result = await writePromptThrough({
      name: "FAIL_SYNC",
      value: "value",
      workspaceId: workspace.id,
      userId: testUser.id,
    });

    // Local write succeeded
    expect(result.name).toBe("FAIL_SYNC");
    // Sync should be marked as PENDING
    const fromDb = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId: workspace.id, name: "FAIL_SYNC" } },
    });
    expect(fromDb?.syncStatus).toBe(PromptSyncStatus.PENDING);
  });

  it("local write succeeds even when fetch throws (network error)", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await writePromptThrough({
      name: "NETWORK_FAIL",
      value: "value",
      workspaceId: workspace.id,
      userId: testUser.id,
    });

    expect(result.name).toBe("NETWORK_FAIL");
    const fromDb = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId: workspace.id, name: "NETWORK_FAIL" } },
    });
    expect(fromDb?.syncStatus).toBe(PromptSyncStatus.PENDING);
  });

  it("creates new version when updating existing prompt", async () => {
    const mockFetch = vi.mocked(global.fetch);
    // Initial create
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: 1 } }) } as Response);

    const created = await writePromptThrough({
      name: "UPDATE_ME",
      value: "v1",
      workspaceId: workspace.id,
      userId: testUser.id,
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response);

    const updated = await writePromptThrough({
      promptId: created.id,
      name: "UPDATE_ME",
      value: "v2",
      workspaceId: workspace.id,
      userId: testUser.id,
    });

    expect(updated.value).toBe("v2");
    expect(updated.versions).toHaveLength(2);
    // Only v2 is published
    const published = updated.versions.filter((v) => v.published);
    expect(published).toHaveLength(1);
    expect(published[0].value).toBe("v2");
    expect(updated.publishedVersionId).toBe(published[0].id);
  });

  it("throws PromptNameInvalidError for bad name format", async () => {
    await expect(
      writePromptThrough({
        name: "invalid-name",
        value: "val",
        workspaceId: workspace.id,
        userId: testUser.id,
      }),
    ).rejects.toThrow(PromptNameInvalidError);
  });

  it("throws PromptConflictError for duplicate name in same workspace", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    await writePromptThrough({ name: "DUPE", value: "v1", workspaceId: workspace.id, userId: testUser.id });

    await expect(
      writePromptThrough({ name: "DUPE", value: "v2", workspaceId: workspace.id, userId: testUser.id }),
    ).rejects.toThrow(PromptConflictError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. publishVersion — live = published transactional rule
// ─────────────────────────────────────────────────────────────────────────────

describe("publishVersion", () => {
  it("publishing an older version sets Prompt.value to that version text atomically", async () => {
    // Create prompt with 3 versions, v3 published (simulating SUMMARIZE_CODE scenario)
    const prompt = await db.prompt.create({
      data: { name: "VERSIONED", value: "v3 text", workspaceId: workspace.id },
    });
    const v1 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "v1 text", published: false, whodunnit: "test" },
    });
    const v2 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 2, value: "v2 text", published: false, whodunnit: "test" },
    });
    const v3 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 3, value: "v3 text", published: true, whodunnit: "test" },
    });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v3.id } });

    // Now publish v2 (an older version)
    const result = await publishVersion(prompt.id, v2.id, workspace.id);

    // Prompt.value MUST mirror the newly published version
    expect(result.value).toBe("v2 text");
    expect(result.publishedVersionId).toBe(v2.id);

    // Only v2 is published; v1 and v3 are not
    const versions = await db.promptVersion.findMany({ where: { promptId: prompt.id } });
    const publishedVersions = versions.filter((v) => v.published);
    expect(publishedVersions).toHaveLength(1);
    expect(publishedVersions[0].id).toBe(v2.id);

    // v1 and v3 must be unpublished
    const v1db = versions.find((v) => v.id === v1.id);
    const v3db = versions.find((v) => v.id === v3.id);
    expect(v1db?.published).toBe(false);
    expect(v3db?.published).toBe(false);
  });

  it("rejects when prompt does not belong to the workspace (IDOR)", async () => {
    const prompt = await db.prompt.create({
      data: { name: "IDOR_TEST", value: "val", workspaceId: workspace.id },
    });

    await expect(
      publishVersion(prompt.id, "some-version-id", otherWorkspace.id),
    ).rejects.toThrow();
  });

  it("rejects when versionId doesn't belong to the prompt", async () => {
    const prompt = await db.prompt.create({
      data: { name: "WRONG_VERSION", value: "val", workspaceId: workspace.id },
    });
    await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "val", published: true },
    });

    // Fabricate a non-existent version ID
    await expect(
      publishVersion(prompt.id, "non-existent-version-id", workspace.id),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Exact prior-version fetch via GET /versions/[versionId]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/workflow/prompts/[id]/versions/[versionId]", () => {
  it("returns the exact value snapshot of a specific version", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    const prompt = await db.prompt.create({
      data: { name: "REPLAY_PROMPT", value: "v3 text", workspaceId: workspace.id },
    });
    const v1 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "exact v1 value for replay", published: false },
    });
    const v2 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 2, value: "exact v2 value for replay", published: false },
    });
    const v3 = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 3, value: "v3 text", published: true },
    });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v3.id } });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts/${prompt.id}/versions/${v2.id}`);
    const res = await GET_VERSION_DETAIL(req, { params: Promise.resolve({ id: prompt.id, versionId: v2.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.value).toBe("exact v2 value for replay");
    expect(body.data.version_number).toBe(2);

    void v1; // suppress unused warning
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Route-level IDOR tests
// ─────────────────────────────────────────────────────────────────────────────

describe("IDOR: routes return 403/404 for unauthorized workspace", () => {
  it("GET /api/workflow/prompts returns 403 for workspace user doesn't belong to", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    const req = makeRequest(
      "GET",
      `http://localhost/api/workflow/prompts?workspace_slug=${otherWorkspace.slug}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("POST /api/workflow/prompts returns 403 for workspace user doesn't own", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    const req = makeRequest("POST", "http://localhost/api/workflow/prompts", {
      name: "TEST_PROMPT",
      value: "val",
      workspace_slug: otherWorkspace.slug,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("GET /api/workflow/prompts/[id] returns 404 for prompt in another workspace", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    // Create prompt in otherWorkspace
    const prompt = await db.prompt.create({
      data: { name: "OTHER_PROMPT", value: "val", workspaceId: otherWorkspace.id },
    });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts/${prompt.id}`);
    const res = await GET_BY_ID(req, { params: Promise.resolve({ id: prompt.id }) });
    // testUser doesn't belong to otherWorkspace → should get 404
    expect(res.status).toBe(404);
  });

  it("DELETE /api/workflow/prompts/[id] returns 404 for prompt in another workspace", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    const prompt = await db.prompt.create({
      data: { name: "TO_DELETE", value: "val", workspaceId: otherWorkspace.id },
    });

    const req = makeRequest("DELETE", `http://localhost/api/workflow/prompts/${prompt.id}`);
    const res = await DELETE(req, { params: Promise.resolve({ id: prompt.id }) });
    expect(res.status).toBe(404);

    // Prompt should still exist (not deleted)
    const still = await db.prompt.findUnique({ where: { id: prompt.id } });
    expect(still).toBeTruthy();
  });

  it("POST .../publish returns 403 for prompt in another workspace", async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));

    const prompt = await db.prompt.create({
      data: { name: "OTHER_PUB", value: "val", workspaceId: otherWorkspace.id },
    });
    const v = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "val", published: true },
    });

    const req = makeRequest("POST", `http://localhost/api/workflow/prompts/${prompt.id}/versions/${v.id}/publish`, {});
    const res = await PUBLISH(req, { params: Promise.resolve({ id: prompt.id, versionId: v.id }) });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Route happy-path integration
// ─────────────────────────────────────────────────────────────────────────────

describe("Route happy-path", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));
    // Allow Stakwork push to succeed silently
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 1 } }),
    } as Response);
  });

  it("POST creates prompt and GET lists it", async () => {
    const createReq = makeRequest("POST", "http://localhost/api/workflow/prompts", {
      name: "ROUTE_TEST",
      value: "route value",
      description: "desc",
      workspace_slug: workspace.slug,
    });
    const createRes = await POST(createReq);
    const createBody = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createBody.success).toBe(true);
    expect(createBody.data.name).toBe("ROUTE_TEST");

    // List
    const listReq = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${workspace.slug}`);
    const listRes = await GET(listReq);
    const listBody = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(listBody.data.prompts).toHaveLength(1);
    expect(listBody.data.total).toBe(1);
  });

  it("GET by ID returns correct prompt", async () => {
    const prompt = await db.prompt.create({
      data: { name: "GET_ME", value: "get value", workspaceId: workspace.id },
    });
    const v = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "get value", published: true },
    });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v.id } });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts/${prompt.id}`);
    const res = await GET_BY_ID(req, { params: Promise.resolve({ id: prompt.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("GET_ME");
    expect(body.data.value).toBe("get value");
  });

  it("PUT updates prompt creating new version", async () => {
    const prompt = await db.prompt.create({
      data: { name: "PUT_ME", value: "original", workspaceId: workspace.id },
    });
    const v = await db.promptVersion.create({
      data: { promptId: prompt.id, versionNumber: 1, value: "original", published: true },
    });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v.id } });

    const req = makeRequest("PUT", `http://localhost/api/workflow/prompts/${prompt.id}`, { value: "updated" });
    const res = await PUT(req, { params: Promise.resolve({ id: prompt.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.value).toBe("updated");
    expect(body.data.version_count).toBe(2);
  });

  it("DELETE removes the prompt", async () => {
    const prompt = await db.prompt.create({
      data: { name: "DEL_ME", value: "delete me", workspaceId: workspace.id },
    });

    const req = makeRequest("DELETE", `http://localhost/api/workflow/prompts/${prompt.id}`);
    const res = await DELETE(req, { params: Promise.resolve({ id: prompt.id }) });
    expect(res.status).toBe(200);

    const gone = await db.prompt.findUnique({ where: { id: prompt.id } });
    expect(gone).toBeNull();
  });

  it("GET /versions lists all versions in desc order", async () => {
    const prompt = await db.prompt.create({
      data: { name: "VER_LIST", value: "v2", workspaceId: workspace.id },
    });
    const v1 = await db.promptVersion.create({ data: { promptId: prompt.id, versionNumber: 1, value: "v1", published: false } });
    const v2 = await db.promptVersion.create({ data: { promptId: prompt.id, versionNumber: 2, value: "v2", published: true } });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v2.id } });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts/${prompt.id}/versions`);
    const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: prompt.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.versions).toHaveLength(2);
    // returned in desc order: v2 first
    expect(body.data.versions[0].version_number).toBe(2);

    void v1; // suppress unused warning
  });

  it("POST .../publish promotes a version and updates Prompt.value", async () => {
    const prompt = await db.prompt.create({
      data: { name: "PUB_TEST", value: "v2 text", workspaceId: workspace.id },
    });
    const v1 = await db.promptVersion.create({ data: { promptId: prompt.id, versionNumber: 1, value: "v1 text", published: false } });
    const v2 = await db.promptVersion.create({ data: { promptId: prompt.id, versionNumber: 2, value: "v2 text", published: true } });
    await db.prompt.update({ where: { id: prompt.id }, data: { publishedVersionId: v2.id } });

    // Publish v1 (older version)
    const req = makeRequest("POST", `http://localhost/api/workflow/prompts/${prompt.id}/versions/${v1.id}/publish`, {});
    const res = await PUBLISH(req, { params: Promise.resolve({ id: prompt.id, versionId: v1.id }) });
    expect(res.status).toBe(200);

    const updated = await db.prompt.findUnique({ where: { id: prompt.id } });
    expect(updated?.value).toBe("v1 text");
    expect(updated?.publishedVersionId).toBe(v1.id);

    const v2db = await db.promptVersion.findUnique({ where: { id: v2.id } });
    expect(v2db?.published).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Unauthorized access
// ─────────────────────────────────────────────────────────────────────────────

describe("Unauthenticated requests return 401", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(null);
  });

  it("GET /api/workflow/prompts returns 401", async () => {
    const req = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${workspace.slug}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("POST /api/workflow/prompts returns 401", async () => {
    const req = makeRequest("POST", "http://localhost/api/workflow/prompts", { name: "X", value: "y", workspace_slug: workspace.slug });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Bulk workspace seed — seedWorkspacePromptsFromStakwork
// ─────────────────────────────────────────────────────────────────────────────

describe("seedWorkspacePromptsFromStakwork", () => {
  // seedWorkspacePromptsFromStakwork only fires when the workspace has its OWN
  // Stakwork token (no global-key fallback — that would import cross-customer data).
  // Store a plain string: decryptField catches JSON.parse failure and returns it as-is.
  let seedWorkspace: { id: string; slug: string };
  beforeEach(async () => {
    seedWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: `seed-ws-${Date.now()}`,
      stakworkApiKey: "fake-test-token",
    });
  });

  it("empty workspace: seeds all Stakwork prompts, stamps promptsSyncedAt", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Page 1: 2 prompts, total=2 (< 20 so no page 2)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            total: 2,
            size: 2,
            prompts: [
              { id: 101, name: "ALPHA_PROMPT", description: "alpha" },
              { id: 102, name: "BETA_PROMPT", description: "beta" },
            ],
          },
        }),
      } as Response)
      // Detail for ALPHA_PROMPT
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 101, name: "ALPHA_PROMPT", value: "Alpha prompt value", description: "alpha" },
        }),
      } as Response)
      // Detail for BETA_PROMPT
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 102, name: "BETA_PROMPT", value: "Beta prompt value", description: "beta" },
        }),
      } as Response);

    await seedWorkspacePromptsFromStakwork(seedWorkspace.id);

    // Both prompts should now be in Hive
    const alpha = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId: seedWorkspace.id, name: "ALPHA_PROMPT" } },
      include: { versions: true },
    });
    expect(alpha).not.toBeNull();
    expect(alpha?.value).toBe("Alpha prompt value");
    expect(alpha?.stakworkId).toBe(101);
    expect(alpha?.versions).toHaveLength(1);
    expect(alpha?.versions[0].published).toBe(true);
    expect(alpha?.versions[0].whodunnit).toBe("stakwork-import");

    const beta = await db.prompt.findUnique({
      where: { workspaceId_name: { workspaceId: seedWorkspace.id, name: "BETA_PROMPT" } },
    });
    expect(beta?.value).toBe("Beta prompt value");

    // Workspace should be stamped
    const ws = await db.workspace.findUnique({ where: { id: seedWorkspace.id }, select: { promptsSyncedAt: true } });
    expect(ws?.promptsSyncedAt).not.toBeNull();
  });

  it("local-wins: existing Hive prompts are not overwritten", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Pre-seed a local prompt with a specific value
    const local = await db.prompt.create({
      data: { name: "EXISTING_PROMPT", value: "local value", workspaceId: seedWorkspace.id },
    });
    const localVersion = await db.promptVersion.create({
      data: { promptId: local.id, versionNumber: 1, value: "local value", published: true },
    });
    await db.prompt.update({ where: { id: local.id }, data: { publishedVersionId: localVersion.id } });

    // Stakwork returns the same-named prompt with a different value
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { total: 1, size: 1, prompts: [{ id: 200, name: "EXISTING_PROMPT" }] },
        }),
      } as Response)
      // Detail fetch — should not be called because local-wins skips it
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 200, name: "EXISTING_PROMPT", value: "STAKWORK OVERWRITE" },
        }),
      } as Response);

    await seedWorkspacePromptsFromStakwork(seedWorkspace.id);

    // The local prompt must retain its original value
    const after = await db.prompt.findUnique({ where: { id: local.id } });
    expect(after?.value).toBe("local value");

    // Detail fetch must not have been called (only 1 fetch: the list page)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("pagination: drains multiple pages", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Page 1: full page of 20, total=22
    const page1Prompts = Array.from({ length: 20 }, (_, i) => ({
      id: 300 + i,
      name: `PAGE_ONE_PROMPT_${String(i).padStart(2, "0")}`,
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { total: 22, size: 20, prompts: page1Prompts },
      }),
    } as Response);

    // Detail fetches for page 1 (20 prompts)
    for (const p of page1Prompts) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: p.id, name: p.name, value: `value for ${p.name}` },
        }),
      } as Response);
    }

    // Page 2: 2 prompts, size=2 < PAGE_SIZE so loop ends
    const page2Prompts = [
      { id: 320, name: "PAGE_TWO_PROMPT_A" },
      { id: 321, name: "PAGE_TWO_PROMPT_B" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { total: 22, size: 2, prompts: page2Prompts },
      }),
    } as Response);

    for (const p of page2Prompts) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: p.id, name: p.name, value: `value for ${p.name}` },
        }),
      } as Response);
    }

    await seedWorkspacePromptsFromStakwork(seedWorkspace.id);

    const count = await db.prompt.count({ where: { workspaceId: seedWorkspace.id } });
    expect(count).toBe(22);
  });

  it("no-token workspace: returns without calling Stakwork, stamps promptsSyncedAt", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Workspace with no workspace-specific stakworkApiKey — seedWorkspacePromptsFromStakwork
    // uses workspace-own token only (no global fallback), so this is a no-op.
    const noTokenWs = await db.workspace.create({
      data: {
        name: "No Token WS",
        slug: `no-token-ws-${Date.now()}`,
        ownerId: testUser.id,
        stakworkApiKey: null,
      },
    });

    await seedWorkspacePromptsFromStakwork(noTokenWs.id);

    // No Stakwork calls
    expect(mockFetch).not.toHaveBeenCalled();

    // promptsSyncedAt is stamped (so we don't retry on next list call)
    const ws = await db.workspace.findUnique({ where: { id: noTokenWs.id }, select: { promptsSyncedAt: true } });
    expect(ws?.promptsSyncedAt).not.toBeNull();

    // Cleanup
    await db.workspace.delete({ where: { id: noTokenWs.id } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET list route — bulk seed via read-through on first call
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/workflow/prompts — bulk seed on first empty-workspace call", () => {
  // Use a workspace with its own Stakwork token so seed fires for the "triggers"
  // tests. The plain "workspace" fixture has no token, so tests that expect no
  // seed call can reuse it directly.
  let tokenWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    mockGetServerSession.mockResolvedValue(makeSession(testUser.id));
    tokenWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: `token-ws-${Date.now()}`,
      stakworkApiKey: "fake-test-token",
    });
  });

  it("empty workspace triggers seed and returns seeded prompts", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Stakwork list returns one prompt
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            total: 1,
            size: 1,
            prompts: [{ id: 500, name: "SEEDED_ON_LIST" }],
          },
        }),
      } as Response)
      // Detail
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 500, name: "SEEDED_ON_LIST", value: "seeded value" },
        }),
      } as Response);

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${tokenWorkspace.slug}`);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.prompts).toHaveLength(1);
    expect(body.data.prompts[0].name).toBe("SEEDED_ON_LIST");
    expect(body.data.total).toBe(1);

    // Workspace stamped
    const ws = await db.workspace.findUnique({ where: { id: tokenWorkspace.id }, select: { promptsSyncedAt: true } });
    expect(ws?.promptsSyncedAt).not.toBeNull();
  });

  it("non-empty workspace does NOT trigger seed (promptsSyncedAt null)", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Pre-seed one local prompt so localCount > 0
    const p = await db.prompt.create({ data: { name: "LOCAL_ONLY", value: "v", workspaceId: workspace.id } });
    const v = await db.promptVersion.create({ data: { promptId: p.id, versionNumber: 1, value: "v", published: true } });
    await db.prompt.update({ where: { id: p.id }, data: { publishedVersionId: v.id } });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${workspace.slug}`);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(1);
    // No Stakwork call
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("already-seeded workspace (promptsSyncedAt set) does NOT re-trigger seed", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Mark workspace as already seeded
    await db.workspace.update({ where: { id: workspace.id }, data: { promptsSyncedAt: new Date() } });

    const req = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${workspace.slug}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("workspace with no Stakwork token: GET list returns empty set without error", async () => {
    // workspace has no stakworkApiKey — seed uses workspace-own token only, so
    // no Stakwork call is made and the route returns an empty (but successful) list.
    const noTokenWs = await db.workspace.create({
      data: {
        name: "No Token List WS",
        slug: `no-token-list-${Date.now()}`,
        ownerId: testUser.id,
        stakworkApiKey: null,
      },
    });
    await db.workspaceMember.create({ data: { workspaceId: noTokenWs.id, userId: testUser.id, role: "OWNER" } }).catch(() => {});

    try {
      const req = makeRequest("GET", `http://localhost/api/workflow/prompts?workspace_slug=${noTokenWs.slug}`);
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.prompts).toHaveLength(0);
      expect(body.data.total).toBe(0);

      // No Stakwork HTTP calls
      expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
    } finally {
      await db.workspace.delete({ where: { id: noTokenWs.id } });
    }
  });
});
