/**
 * Integration tests for POST /api/webhook/errors
 *
 * Verifies: auth, IDOR safety, repo resolution, fingerprint grouping,
 * ErrorIssue upsert, ErrorEvent creation, and Pusher broadcast.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { generateUniqueId, generateUniqueSlug, generateUniqueEmail } from "@/__tests__/support/helpers";
import { hashApiKey } from "@/lib/api-keys";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockPusherTrigger } = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
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
    expect(issue?.repoKey).toBe(ctx.repo.id);

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
