/**
 * Integration tests for POST /api/webhook/errors
 *
 * Verifies: auth, IDOR safety, repo resolution, fingerprint grouping,
 * ErrorIssue upsert, ErrorEvent creation, Pusher broadcast, and KG projection.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { generateUniqueId, generateUniqueSlug, generateUniqueEmail } from "@/__tests__/support/helpers";
import { hashApiKey } from "@/lib/api-keys";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockPusherTrigger,
  mockAddNode,
  mockAddEdge,
  mockSearchNodesByAttributes,
  mockGetJarvisConfig,
  mockGetReferencedNodeCentrality,
  mockComputeImpactScore,
} = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
  mockAddNode: vi.fn(),
  mockAddEdge: vi.fn(),
  mockSearchNodesByAttributes: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockGetReferencedNodeCentrality: vi.fn(),
  mockComputeImpactScore: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: { trigger: mockPusherTrigger },
  };
});

// Blob mock — no real network calls
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/error-event.json" }),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
  searchNodesByAttributes: mockSearchNodesByAttributes,
  getReferencedNodeCentrality: mockGetReferencedNodeCentrality,
}));

vi.mock("@/services/error-impact", () => ({
  computeImpactScore: mockComputeImpactScore,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

import { POST } from "@/app/api/webhook/errors/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: Record<string, unknown>, key?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return new NextRequest("http://localhost/api/webhook/errors", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function buildRequestWithXApiKey(body: Record<string, unknown>, key: string): NextRequest {
  return new NextRequest("http://localhost/api/webhook/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
}

const RAW_KEY = "hive_test_secretkey1234567890abcdefghij";

async function createTestSetup() {
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: generateUniqueEmail("errors-wh"),
        name: "Test Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Test Workspace",
        slug: generateUniqueSlug("errors-ws"),
        ownerId: owner.id,
      },
    });

    const repo = await tx.repository.create({
      data: {
        id: generateUniqueId("repo"),
        name: "hive",
        repositoryUrl: "https://github.com/stakwork/hive",
        workspaceId: workspace.id,
      },
    });

    // Create a second workspace + repo to test IDOR
    const owner2 = await tx.user.create({
      data: {
        id: generateUniqueId("user2"),
        email: generateUniqueEmail("errors-wh2"),
        name: "Other Owner",
      },
    });
    const workspace2 = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace2"),
        name: "Other Workspace",
        slug: generateUniqueSlug("errors-ws2"),
        ownerId: owner2.id,
      },
    });
    const repo2 = await tx.repository.create({
      data: {
        id: generateUniqueId("repo2"),
        name: "secret-repo",
        repositoryUrl: "https://github.com/other-org/secret-repo",
        workspaceId: workspace2.id,
      },
    });

    // Create an API key for workspace 1
    const keyHash = hashApiKey(RAW_KEY);
    const apiKey = await tx.workspaceApiKey.create({
      data: {
        workspaceId: workspace.id,
        name: "Test Ingest Key",
        keyPrefix: RAW_KEY.slice(0, 8),
        keyHash,
        createdById: owner.id,
      },
    });

    return { owner, workspace, repo, owner2, workspace2, repo2, apiKey };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/errors — auth", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    // cleanup in dependency order
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    // cleanup workspace2
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("returns 401 when no key is provided", async () => {
    const req = new NextRequest("http://localhost/api/webhook/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exceptionType: "TypeError", message: "oops" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 when key is invalid", async () => {
    const res = await POST(buildRequest({ exceptionType: "TypeError", message: "oops" }, "hive_bad_key"));
    expect(res.status).toBe(401);
  });

  test("returns 401 when key is revoked", async () => {
    await db.workspaceApiKey.update({
      where: { id: ctx.apiKey.id },
      data: { revokedAt: new Date() },
    });
    const res = await POST(buildRequest({ exceptionType: "TypeError", message: "oops" }, RAW_KEY));
    expect(res.status).toBe(401);
  });

  test("accepts x-api-key header as fallback", async () => {
    const res = await POST(
      buildRequestWithXApiKey({ exceptionType: "TypeError", message: "oops" }, RAW_KEY)
    );
    expect(res.status).toBe(201);
  });
});

describe("POST /api/webhook/errors — validation", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("returns 400 when exceptionType is missing", async () => {
    const res = await POST(buildRequest({ message: "oops" }, RAW_KEY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/exceptionType/i);
  });

  test("returns 400 when message is missing", async () => {
    const res = await POST(buildRequest({ exceptionType: "TypeError" }, RAW_KEY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/message/i);
  });
});

describe("POST /api/webhook/errors — happy path", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("201 — first occurrence creates ErrorIssue + ErrorEvent with occurrenceCount 1", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "Cannot read properties of undefined",
          stackTrace: "  at foo (bar.ts:10:5)",
          environment: "production",
          release: "v1.0.0",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.isNew).toBe(true);
    expect(body.data.occurrenceCount).toBe(1);
    expect(body.data.repositoryId).toBe(ctx.repo.id);

    // DB check
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue).not.toBeNull();
    expect(issue?.occurrenceCount).toBe(1);
    expect(issue?.workspaceId).toBe(ctx.workspace.id);
    expect(issue?.repositoryId).toBe(ctx.repo.id);
    expect(issue?.repoKey).toBe("stakwork/hive");

    const event = await db.errorEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event).not.toBeNull();
    expect(event?.issueId).toBe(issue?.id);
    expect(event?.blobUrl).toContain("blob.example.com");
  });

  test("second occurrence with same fingerprint and same repo upserts (occurrenceCount increments)", async () => {
    const payload = {
      exceptionType: "TypeError",
      message: "Cannot read properties of undefined",
      stackTrace: "  at foo (bar.ts:10:5)\n  at baz (qux.ts:5:2)",
      repository: "hive", // match by name
    };

    // First call
    const res1 = await POST(buildRequest(payload, RAW_KEY));
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.data.isNew).toBe(true);
    expect(body1.data.occurrenceCount).toBe(1);

    // Second call — same fingerprint, same repo
    const res2 = await POST(buildRequest(payload, RAW_KEY));
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.data.isNew).toBe(false);
    expect(body2.data.occurrenceCount).toBe(2);
    expect(body2.data.issueId).toBe(body1.data.issueId); // same issue

    // Only 1 ErrorIssue row
    const count = await db.errorIssue.count({
      where: { id: body1.data.issueId },
    });
    expect(count).toBe(1);

    // 2 ErrorEvent rows
    const eventCount = await db.errorEvent.count({
      where: { issueId: body1.data.issueId },
    });
    expect(eventCount).toBe(2);
  });

  test("same fingerprint in different repos creates two separate ErrorIssue rows", async () => {
    // Create a second repo in workspace 1
    const repo2 = await db.repository.create({
      data: {
        id: generateUniqueId("repo-b"),
        name: "workspaces",
        repositoryUrl: "https://github.com/stakwork/workspaces",
        workspaceId: ctx.workspace.id,
      },
    });

    try {
      // Same error, repo 1
      const res1 = await POST(
        buildRequest(
          { exceptionType: "TypeError", message: "boom", fingerprint: "shared-fp", repository: "hive" },
          RAW_KEY
        )
      );
      expect(res1.status).toBe(201);
      const body1 = await res1.json();

      // Same error, repo 2 (same workspace, different repo)
      const res2 = await POST(
        buildRequest(
          { exceptionType: "TypeError", message: "boom", fingerprint: "shared-fp", repository: "workspaces" },
          RAW_KEY
        )
      );
      expect(res2.status).toBe(201);
      const body2 = await res2.json();

      // Two distinct issues
      expect(body1.data.issueId).not.toBe(body2.data.issueId);
      expect(body1.data.repositoryId).toBe(ctx.repo.id);
      expect(body2.data.repositoryId).toBe(repo2.id);
    } finally {
      await db.errorEvent.deleteMany({ where: { repositoryId: repo2.id } });
      await db.errorIssue.deleteMany({ where: { repositoryId: repo2.id } });
      await db.repository.delete({ where: { id: repo2.id } });
    }
  });

  test('unresolved repo falls back to repoKey "unknown" and groups deterministically', async () => {
    const payload = {
      exceptionType: "NetworkError",
      message: "fetch failed",
      // no repository field
    };

    const res1 = await POST(buildRequest(payload, RAW_KEY));
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.data.repositoryId).toBeNull();

    const issue = await db.errorIssue.findUnique({ where: { id: body1.data.issueId } });
    expect(issue?.repoKey).toBe("unknown");
    expect(issue?.repositoryId).toBeNull();

    // Second call — same fingerprint, no repo — should upsert the same issue
    const res2 = await POST(buildRequest(payload, RAW_KEY));
    const body2 = await res2.json();
    expect(body2.data.issueId).toBe(body1.data.issueId);
    expect(body2.data.occurrenceCount).toBe(2);
  });

  test("client-supplied fingerprint groups distinctly from the computed default", async () => {
    const basePayload = {
      exceptionType: "TypeError",
      message: "Something failed",
      stackTrace: "  at foo (bar.ts:10:5)",
    };

    // Computed fingerprint
    const res1 = await POST(buildRequest(basePayload, RAW_KEY));
    const body1 = await res1.json();

    // Client override fingerprint
    const res2 = await POST(
      buildRequest({ ...basePayload, fingerprint: "my-custom-fp" }, RAW_KEY)
    );
    const body2 = await res2.json();

    expect(body1.data.issueId).not.toBe(body2.data.issueId);
    expect(body1.data.fingerprint).not.toBe("my-custom-fp");
    expect(body2.data.fingerprint).toBe("my-custom-fp");
  });

  test("Pusher broadcast is triggered with expected payload", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "boom",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);

    expect(mockPusherTrigger).toHaveBeenCalledOnce();
    const [channel, event, payload] = mockPusherTrigger.mock.calls[0];

    expect(channel).toBe(`workspace-${ctx.workspace.slug}`);
    expect(event).toBe("error-issue-updated");
    expect(payload).toMatchObject({
      isNew: true,
      occurrenceCount: 1,
      repositoryId: ctx.repo.id,
      status: "UNRESOLVED",
    });
    expect(typeof payload.id).toBe("string");
    expect(typeof payload.fingerprint).toBe("string");
  });

  test("commitSha is persisted on first occurrence when provided", async () => {
    const sha = "abc1234def5678abc1234def5678abc1234def56";
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "sha test error",
          commitSha: sha,
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const event = await db.errorEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event?.commitSha).toBe(sha);
  });

  test("commitSha defaults to null when omitted", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "no sha error",
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const event = await db.errorEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event?.commitSha).toBeNull();
  });

  test("empty string commitSha is treated as null", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "empty sha error",
          commitSha: "",
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const event = await db.errorEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event?.commitSha).toBeNull();
  });

  test("each occurrence stores its own commitSha independently", async () => {
    const sha1 = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";
    const sha2 = "ffff6666aaaa1111bbbb2222cccc3333dddd4444";
    const payload = {
      exceptionType: "TypeError",
      message: "repeated sha error",
      stackTrace: "  at foo (bar.ts:10:5)",
      repository: "hive",
    };

    const res1 = await POST(buildRequest({ ...payload, commitSha: sha1 }, RAW_KEY));
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    const event1 = await db.errorEvent.findUnique({ where: { id: body1.data.eventId } });
    expect(event1?.commitSha).toBe(sha1);

    const res2 = await POST(buildRequest({ ...payload, commitSha: sha2 }, RAW_KEY));
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.data.issueId).toBe(body1.data.issueId); // same issue
    const event2 = await db.errorEvent.findUnique({ where: { id: body2.data.eventId } });
    expect(event2?.commitSha).toBe(sha2);
  });

  test("201 is returned even when Pusher broadcast throws", async () => {
    mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher down"));

    const res = await POST(
      buildRequest({ exceptionType: "TypeError", message: "oops" }, RAW_KEY)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe("POST /api/webhook/errors — IDOR safety", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("repo from a different workspace is NOT matched even if its URL is supplied", async () => {
    // ctx.repo2 belongs to workspace2 but we're authenticated as workspace1's key
    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "boom",
          // Supply workspace2's repo URL — must not resolve
          repository: "https://github.com/other-org/secret-repo",
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    // Must NOT resolve to repo2
    expect(body.data.repositoryId).toBeNull();

    // The issue must land in workspace1, NOT workspace2
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.workspaceId).toBe(ctx.workspace.id);
  });
});

// ── KG projection tests ───────────────────────────────────────────────────────

describe("POST /api/webhook/errors — KG projection (best-effort)", () => {
  const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    // Default: Pusher succeeds silently
    mockPusherTrigger.mockResolvedValue(undefined);
    // Default: centrality returns no nodes (impact unscored) — tests that need
    // specific behaviour override these defaults
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("no swarm configured → 201, kgRefId stays null, no addNode called", async () => {
    mockGetJarvisConfig.mockResolvedValue(null);

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "boom", repository: "https://github.com/stakwork/hive" },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(mockAddEdge).not.toHaveBeenCalled();

    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.kgRefId).toBeNull();
  });

  test("swarm configured + resolved repo → ErrorIssue node upserted, kgRefId persisted", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-001" });
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "Cannot read properties",
          stackTrace: "  at foo (bar.ts:10:5)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();

    // addNode called for ErrorIssue
    expect(mockAddNode).toHaveBeenCalledOnce();
    const [, nodePayload, opts] = mockAddNode.mock.calls[0];
    expect(nodePayload.node_type).toBe("ErrorIssue");
    expect(nodePayload.node_data).toMatchObject({
      exceptionType: "TypeError",
      status: "UNRESOLVED",
      workspace_id: ctx.workspace.id,
      repository_id: ctx.repo.id,
    });
    expect(opts).toEqual({ reprocess: true });

    // kgRefId persisted to DB
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.kgRefId).toBe("issue-ref-001");
  });

  test("repeat occurrence (isNew=false) → addNode called with reprocess:true, kgRefId stable", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-stable" });
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const payload = {
      exceptionType: "TypeError",
      message: "repeated error",
      stackTrace: "  at doWork (worker.ts:5:3)",
      repository: "hive",
    };

    // First occurrence
    const res1 = await POST(buildRequest(payload, RAW_KEY));
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.data.isNew).toBe(true);

    mockAddNode.mockClear();
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-stable" });

    // Second occurrence — same fingerprint
    const res2 = await POST(buildRequest(payload, RAW_KEY));
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.data.isNew).toBe(false);
    expect(body2.data.issueId).toBe(body1.data.issueId);

    // addNode must be called with reprocess:true on the second call too
    expect(mockAddNode).toHaveBeenCalledOnce();
    const [, , opts] = mockAddNode.mock.calls[0];
    expect(opts).toEqual({ reprocess: true });

    // kgRefId is stable (same ref_id from both calls)
    const issue = await db.errorIssue.findUnique({ where: { id: body1.data.issueId } });
    expect(issue?.kgRefId).toBe("issue-ref-stable");
  });

  test("unresolved repositoryId → KG node upserted, zero code edges drawn", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-no-repo" });
    // searchNodesByAttributes should NOT be called when repo is unresolved
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "NetworkError",
          message: "fetch failed",
          stackTrace: "  at fetch (http.ts:20:1)",
          // no repository → repoKey = "unknown", repositoryId = null
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.repositoryId).toBeNull();

    // ErrorIssue node must still be upserted
    expect(mockAddNode).toHaveBeenCalledOnce();
    const [, nodePayload] = mockAddNode.mock.calls[0];
    expect(nodePayload.node_type).toBe("ErrorIssue");
    expect(nodePayload.node_data.repository_id).toBeNull();

    // No edges should be drawn (no repo scope)
    expect(mockAddEdge).not.toHaveBeenCalled();
    // searchNodesByAttributes should not be called either
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();

    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.kgRefId).toBe("issue-ref-no-repo");
  });

  test("File/Function edges drawn only to nodes matching the queried file path (exact =)", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-with-edges" });
    mockAddEdge.mockResolvedValue({ success: true });

    // Per-file exact query: returns only the node for that file path.
    // The other-repo node would never appear since we query by exact file path.
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-in-correct-repo",
          node_type: "File",
          properties: {
            file: "stakwork/hive/src/foo/bar.ts",
            namespace: "default",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "boom",
          // stack frame referencing full relative path — matches by suffix
          stackTrace: "  at doThing (src/foo/bar.ts:10:5)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);

    // Verify per-file exact-match call with comparator "=" (not "contains")
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, searchParams] = mockSearchNodesByAttributes.mock.calls[0];
    expect(searchParams.nodeTypes).toEqual(["File", "Function"]);
    // The filter must use exact "=" comparator on the full repo-qualified path
    expect(searchParams.filters).toHaveLength(1);
    expect(searchParams.filters[0].attribute).toBe("file");
    expect(searchParams.filters[0].comparator).toBe("=");
    expect(searchParams.filters[0].value).toBe("stakwork/hive/bar.ts"); // basename from stackTrace fallback
    expect(searchParams.includeProperties).toBe(true);

    // Only one edge drawn — to the node in the correct repo
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.edge.edge_type).toBe("REFERENCES");
    expect(edgePayload.source.ref_id).toBe("issue-ref-with-edges");
    expect(edgePayload.target.ref_id).toBe("file-in-correct-repo");
  });

  test("regression guard: >1000 total workspace nodes — repo-scoped fetch returns issue's repo nodes regardless", async () => {
    // Seed senza-lnd as a repo in the test workspace so repositoryId resolves
    // (the route skips code-edge drawing entirely when repositoryId is null)
    const senzaRepo = await db.repository.create({
      data: {
        id: generateUniqueId("repo-senza"),
        name: "senza-lnd",
        repositoryUrl: "https://github.com/stakwork/senza-lnd",
        workspaceId: ctx.workspace.id,
      },
    });

    try {
      mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
      mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-old-repo" });
      mockAddEdge.mockResolvedValue({ success: true });

      // The new searchNodesByAttributes is called with a repo filter, so it
      // returns the issue repo's nodes even though there are >1000 total workspace
      // File nodes. (The old searchLatestByTypes would have missed this repo.)
      mockSearchNodesByAttributes.mockResolvedValue({
        ok: true,
        nodes: [
          {
            ref_id: "file-old-repo-controller",
            node_type: "File",
            properties: {
              file: "stakwork/senza-lnd/app/controllers/admin/blacklists_controller.rb",
              namespace: "default",
            },
          },
        ],
      });

      const res = await POST(
        buildRequest(
          {
            exceptionType: "ActiveRecord::NotFound",
            message: "Couldn't find Blacklist",
            frames: [
              {
                filename: "app/controllers/admin/blacklists_controller.rb",
                function: "show",
                lineno: 14,
                inApp: true,
              },
            ],
            repository: "https://github.com/stakwork/senza-lnd",
          },
          RAW_KEY
        )
      );

      expect(res.status).toBe(201);

      // searchNodesByAttributes was called with per-file exact-match for the frame's path
      expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
      const [, searchParams] = mockSearchNodesByAttributes.mock.calls[0];
      expect(searchParams.filters).toHaveLength(1);
      expect(searchParams.filters[0].attribute).toBe("file");
      expect(searchParams.filters[0].comparator).toBe("=");
      // Exact path: repoKey + "/" + normalized frame path
      expect(searchParams.filters[0].value).toBe(
        "stakwork/senza-lnd/app/controllers/admin/blacklists_controller.rb",
      );

      // Edge drawn to the correct node — old-repo bug would have drawn 0 edges
      expect(mockAddEdge).toHaveBeenCalledOnce();
      const [, edgePayload] = mockAddEdge.mock.calls[0];
      expect(edgePayload.target.ref_id).toBe("file-old-repo-controller");
    } finally {
      await db.errorEvent.deleteMany({ where: { repositoryId: senzaRepo.id } });
      await db.errorIssue.deleteMany({ where: { repositoryId: senzaRepo.id } });
      await db.repository.delete({ where: { id: senzaRepo.id } });
    }
  });

  test("unresolvable stack frame path → edge skipped, no throw, 201 returned", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-no-match" });
    // Return nodes but none matching the stack frame's file
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "unrelated-file",
          node_type: "File",
          properties: {
            file: "stakwork/hive/src/completely/different.ts",
            namespace: "default",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "ReferenceError",
          message: "x is not defined",
          stackTrace: "  at compute (unknownFile.ts:3:1)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // No edges since the file couldn't be matched
    expect(mockAddEdge).not.toHaveBeenCalled();

    // kgRefId still persisted
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.kgRefId).toBe("issue-ref-no-match");
  });

  test("thrown Jarvis call in projection block → caught, 201 response unaffected, DB rows intact", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockRejectedValue(new Error("Jarvis network failure"));

    const res = await POST(
      buildRequest(
        {
          exceptionType: "Error",
          message: "something broke",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // DB rows must exist regardless of KG failure
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue).not.toBeNull();
    expect(issue?.kgRefId).toBeNull(); // never persisted due to the throw

    const event = await db.errorEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event).not.toBeNull();
  });

  test("getJarvisConfigForWorkspace throws → caught, 201 response unaffected", async () => {
    mockGetJarvisConfig.mockRejectedValue(new Error("Config fetch failed"));

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "oops" },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  test("searchNodesByAttributes fails → edges skipped gracefully, 201 returned", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-search-fail" });
    // Simulate a failed search (network error)
    mockSearchNodesByAttributes.mockResolvedValue({ ok: false, nodes: [], error: "timeout" });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "boom",
          stackTrace: "  at foo (bar.ts:10:5)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    expect(mockAddEdge).not.toHaveBeenCalled();

    const body = await res.json();
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.kgRefId).toBe("issue-ref-search-fail");
  });
});

// ── Frames ingest tests ───────────────────────────────────────────────────────

describe("POST /api/webhook/errors — structured frames", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockGetJarvisConfig.mockResolvedValue(null);
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("201 — request with valid frames array is accepted", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "ActiveRecord::NotFound",
          message: "Record not found",
          frames: [
            { filename: "app/controllers/users_controller.rb", function: "show", lineno: 10, inApp: true },
            { filename: "app/models/user.rb", function: "find", lineno: 5, inApp: true },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.issueId).toBeTruthy();
  });

  test("frames are sanitized and written to blob body before put()", async () => {
    const { put: mockPut } = await vi.importMock<typeof import("@vercel/blob")>("@vercel/blob");

    await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "bad stuff",
          frames: [
            { filename: "app/foo.rb", function: "bar", lineno: 42, inApp: true, extraField: "should-be-stripped" },
            { function: "no-filename", lineno: 5 }, // malformed — dropped
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(mockPut).toHaveBeenCalledOnce();
    const blobBody = JSON.parse((mockPut as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    // Sanitized frames should be in blob
    expect(blobBody.frames).toHaveLength(1);
    expect(blobBody.frames[0]).toEqual({ filename: "app/foo.rb", function: "bar", lineno: 42, inApp: true });
    // Extra field stripped
    expect(blobBody.frames[0]).not.toHaveProperty("extraField");
  });

  test("malformed frames entries are stripped from blob", async () => {
    const { put: mockPut } = await vi.importMock<typeof import("@vercel/blob")>("@vercel/blob");

    await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "test",
          frames: [
            null,
            { filename: "" },
            { function: "no-filename" },
            { filename: "valid.rb", lineno: 1 },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    const blobBody = JSON.parse((mockPut as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(blobBody.frames).toHaveLength(1);
    expect(blobBody.frames[0].filename).toBe("valid.rb");
  });

  test("201 — request with only legacy stackTrace (no frames) still works", async () => {
    const res = await POST(
      buildRequest(
        {
          exceptionType: "ReferenceError",
          message: "x is not defined",
          stackTrace: "  at eval (eval:1:1)\n  at main (app.js:5:1)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("same frames on two separate calls produce the same fingerprint (grouping)", async () => {
    const payload = {
      exceptionType: "ActiveRecord::NotFound",
      message: "Record not found",
      frames: [
        { filename: "app/controllers/users_controller.rb", function: "show", lineno: 10, inApp: true },
      ],
      repository: "https://github.com/stakwork/hive",
    };

    const res1 = await POST(buildRequest(payload, RAW_KEY));
    const res2 = await POST(buildRequest(payload, RAW_KEY));
    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    // Same fingerprint → same issue, occurrenceCount incremented
    expect(body1.data.issueId).toBe(body2.data.issueId);
    expect(body2.data.occurrenceCount).toBe(2);
  });

  test("non-array frames value is treated as empty (no frames)", async () => {
    const { put: mockPut } = await vi.importMock<typeof import("@vercel/blob")>("@vercel/blob");

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "test",
          frames: "not-an-array",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );
    expect(res.status).toBe(201);
    const blobBody = JSON.parse((mockPut as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(blobBody.frames).toEqual([]);
  });
});

// ── Impact scoring tests ──────────────────────────────────────────────────────

describe("POST /api/webhook/errors — opportunistic impact scoring", () => {
  const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockPusherTrigger.mockResolvedValue(undefined);
    // Default: centrality returns no nodes
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("201 response is unaffected when centrality fetch returns empty nodes (unscored)", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-impact-test" });
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "boom", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // impactScore should be null (unscored)
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.impactScore).toBeNull();
  });

  test("201 response is unaffected when centrality fetch fails (graph unavailable)", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-impact-fail" });
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });
    // Simulate a hard graph failure
    mockGetReferencedNodeCentrality.mockRejectedValue(new Error("Graph timeout"));

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "graph-fail", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );
    // Must still return 201 — graph failure is non-fatal
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("impact score is persisted when centrality nodes are available", async () => {
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-impact-ok" });
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "file-ref", node_type: "File", name: "core.ts", pagerank: 0.8 }],
    });
    mockComputeImpactScore.mockReturnValue({
      score: 0.8,
      meta: { topNodeName: "core.ts", topNodeType: "File", topPagerank: 0.8, nodeCount: 1 },
    });

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "central error", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Allow a brief tick for the async DB update to complete
    await new Promise((r) => setTimeout(r, 50));

    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.impactScore).toBe(0.8);
    expect(issue?.impactScoredAt).not.toBeNull();
  });
});

// ── Frame-based KG edge resolution integration tests ─────────────────────────

describe("POST /api/webhook/errors — KG edges from structured frames (Ruby + JS fallback)", () => {
  const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockPusherTrigger.mockResolvedValue(undefined);
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-ruby" });
    mockAddEdge.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("Ruby payload with structured frames draws edges to correct File/Function nodes", async () => {
    // Two workers share a `perform` method — only the one matching the frame filename should be linked
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-script-worker",
          node_type: "File",
          properties: {
            file: "stakwork/hive/app/workers/script_graph_recorder_worker.rb",
            namespace: "default",
          },
        },
        {
          ref_id: "func-perform-correct",
          node_type: "Function",
          properties: {
            name: "perform",
            file: "stakwork/hive/app/workers/script_graph_recorder_worker.rb",
            namespace: "default",
          },
        },
        {
          ref_id: "func-perform-wrong",
          node_type: "Function",
          properties: {
            name: "perform",
            file: "stakwork/hive/app/workers/other_worker.rb",
            namespace: "default",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "Sidekiq::Error",
          message: "Job failed",
          frames: [
            {
              filename: "app/workers/script_graph_recorder_worker.rb",
              function: "perform",
              lineno: 9,
              inApp: true,
            },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);

    // Two edges: one to File, one to Function (correct one only)
    expect(mockAddEdge).toHaveBeenCalledTimes(2);
    const targetRefIds = mockAddEdge.mock.calls.map((c: unknown[]) => (c[1] as { target: { ref_id: string } }).target.ref_id);
    expect(targetRefIds).toContain("file-script-worker");
    expect(targetRefIds).toContain("func-perform-correct");
    // Must NOT link to wrong perform
    expect(targetRefIds).not.toContain("func-perform-wrong");
  });

  test("JS stackTrace-only payload (no frames) resolves via parseStackFrames fallback", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-bar-ts",
          node_type: "File",
          properties: {
            file: "stakwork/hive/src/foo/bar.ts",
            namespace: "default",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "x is not defined",
          stackTrace: "  at doThing (src/foo/bar.ts:10:5)",
          repository: "https://github.com/stakwork/hive",
          // No frames — should fall back to parseStackFrames
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    // Edge drawn via stackTrace fallback
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.target.ref_id).toBe("file-bar-ts");
  });

  test("nodes with only `file` property (not `file_path`) still draw edges", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-only-file-key",
          node_type: "File",
          properties: {
            // Deliberately no file_path — only the real `file` key
            file: "stakwork/hive/app/services/my_service.rb",
            namespace: "default",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "RuntimeError",
          message: "something went wrong",
          frames: [
            { filename: "app/services/my_service.rb", function: "call", lineno: 20, inApp: true },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY
      )
    );

    expect(res.status).toBe(201);
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.target.ref_id).toBe("file-only-file-key");
  });
});

// ── Per-file exact-match KG fetch tests ──────────────────────────────────────

describe("POST /api/webhook/errors — per-file exact-match KG fetch (comparator '=')", () => {
  const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "jarvis-key" };
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockPusherTrigger.mockResolvedValue(undefined);
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-ref-exact" });
    mockAddEdge.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("jarvis request uses comparator '=' on attribute 'file', never 'contains'", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-controller",
          node_type: "File",
          properties: { file: "stakwork/hive/app/controllers/admin/translations_controller.rb" },
        },
        {
          ref_id: "func-edit",
          node_type: "Function",
          properties: {
            name: "edit",
            file: "stakwork/hive/app/controllers/admin/translations_controller.rb",
          },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "ActiveRecord::NotFound",
          message: "Couldn't find Translation",
          frames: [
            {
              filename: "app/controllers/admin/translations_controller.rb",
              function: "edit",
              lineno: 14,
              inApp: true,
            },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);

    // All calls must use "=" comparator — never "contains" or "~="
    for (const call of mockSearchNodesByAttributes.mock.calls) {
      const [, params] = call;
      for (const filter of params.filters) {
        expect(filter.comparator).toBe("=");
        expect(filter.comparator).not.toBe("contains");
        expect(filter.comparator).not.toBe("~=");
      }
    }

    // Both File and Function edges drawn
    expect(mockAddEdge).toHaveBeenCalledTimes(2);
    const targetRefIds = mockAddEdge.mock.calls.map(
      (c: unknown[]) => (c[1] as { target: { ref_id: string } }).target.ref_id,
    );
    expect(targetRefIds).toContain("file-controller");
    expect(targetRefIds).toContain("func-edit");
  });

  test("exact file= match → REFERENCES edges drawn + non-null impact score persisted", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "func-edit-central",
          node_type: "Function",
          properties: {
            name: "edit",
            file: "stakwork/hive/app/controllers/admin/translations_controller.rb",
            pagerank: 0.405,
          },
        },
      ],
    });
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "func-edit-central", node_type: "Function", name: "edit", pagerank: 0.405 }],
    });
    mockComputeImpactScore.mockReturnValue({
      score: 0.405,
      meta: { topNodeName: "edit", topNodeType: "Function", topPagerank: 0.405, nodeCount: 1 },
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "ActiveRecord::NotFound",
          message: "Couldn't find Translation",
          frames: [
            {
              filename: "app/controllers/admin/translations_controller.rb",
              function: "edit",
              lineno: 14,
              inApp: true,
            },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);

    // Edge drawn
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.target.ref_id).toBe("func-edit-central");

    // Allow async DB write to complete
    await new Promise((r) => setTimeout(r, 50));

    const body = await res.json();
    const issue = await db.errorIssue.findUnique({ where: { id: body.data.issueId } });
    expect(issue?.impactScore).toBe(0.405);
    expect(issue?.impactScoredAt).not.toBeNull();
  });

  test("one failed per-file query does not block others — remaining edges drawn, 201 returned", async () => {
    // First call fails, second succeeds
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: false, error: "lookup timeout", nodes: [] })
      .mockResolvedValueOnce({
        ok: true,
        nodes: [
          {
            ref_id: "file-service",
            node_type: "File",
            properties: { file: "stakwork/hive/app/services/my_service.rb" },
          },
        ],
      });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "RuntimeError",
          message: "service crashed",
          frames: [
            // Two different files — first will fail, second will succeed
            { filename: "app/controllers/admin/broken_controller.rb", function: "index", lineno: 5, inApp: true },
            { filename: "app/services/my_service.rb", function: "call", lineno: 20, inApp: true },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    // Must still return 201 — one failed file is non-fatal
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Two per-file queries were made
    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(2);

    // Edge drawn for the successful file only
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.target.ref_id).toBe("file-service");
  });

  test("rejected/thrown per-file query is skipped — others draw, 201 returned", async () => {
    mockSearchNodesByAttributes
      .mockRejectedValueOnce(new Error("network timeout for broken_controller"))
      .mockResolvedValueOnce({
        ok: true,
        nodes: [
          {
            ref_id: "file-worker",
            node_type: "File",
            properties: { file: "stakwork/hive/app/workers/my_worker.rb" },
          },
        ],
      });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "Sidekiq::Error",
          message: "job failed",
          frames: [
            { filename: "app/controllers/admin/broken_controller.rb", function: "index", lineno: 5, inApp: true },
            { filename: "app/workers/my_worker.rb", function: "perform", lineno: 12, inApp: true },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    expect(mockAddEdge).toHaveBeenCalledOnce();
    const [, edgePayload] = mockAddEdge.mock.calls[0];
    expect(edgePayload.target.ref_id).toBe("file-worker");
  });

  test("basename-only stackTrace fallback frame produces no edge (documented limitation)", async () => {
    // parseStackFrames (stackTrace fallback) reduces paths to a bare basename
    // (e.g. "bar.ts"), so the per-file exact query becomes
    // "stakwork/hive/bar.ts" — jarvis returns no nodes for that path because
    // the real node lives at "stakwork/hive/src/foo/bar.ts".
    // We simulate this by returning empty nodes for the exact query on the basename.
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "TypeError",
          message: "x is not defined",
          // No frames — triggers stackTrace fallback; parseStackFrames returns basename "bar.ts"
          stackTrace: "  at doThing (src/foo/bar.ts:10:5)",
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    // The query was made with the basename path (not the full path), and
    // jarvis returned no nodes → no edge drawn. Non-fatal, no throw.
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, params] = mockSearchNodesByAttributes.mock.calls[0];
    // Query uses basename "bar.ts" (not the full "src/foo/bar.ts")
    expect(params.filters[0].value).toBe("stakwork/hive/bar.ts");
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("multiple frames pointing to same file → only one per-file query (deduped)", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "file-controller",
          node_type: "File",
          properties: { file: "stakwork/hive/app/controllers/orders_controller.rb" },
        },
      ],
    });

    const res = await POST(
      buildRequest(
        {
          exceptionType: "ActiveRecord::NotFound",
          message: "Order not found",
          frames: [
            // Three frames from the same file — should dedupe to one query
            { filename: "app/controllers/orders_controller.rb", function: "show", lineno: 10, inApp: true },
            { filename: "app/controllers/orders_controller.rb", function: "authorize", lineno: 25, inApp: true },
            { filename: "app/controllers/orders_controller.rb", function: "find_order", lineno: 40, inApp: true },
          ],
          repository: "https://github.com/stakwork/hive",
        },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);

    // Only ONE query issued despite 3 frames from the same file
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, params] = mockSearchNodesByAttributes.mock.calls[0];
    expect(params.filters[0].value).toBe("stakwork/hive/app/controllers/orders_controller.rb");
  });
});
