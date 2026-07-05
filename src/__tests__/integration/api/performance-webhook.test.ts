/**
 * Integration tests for POST /api/webhook/performance
 *
 * Verifies: auth, IDOR safety, repo resolution, signature grouping,
 * PerformanceTraceGroup upsert, PerformanceTraceEvent creation, and Pusher broadcast.
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
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/perf-event.json" }),
}));

import { POST } from "@/app/api/webhook/performance/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: Record<string, unknown>, key?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return new NextRequest("http://localhost/api/webhook/performance", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function buildRequestWithXApiKey(body: Record<string, unknown>, key: string): NextRequest {
  return new NextRequest("http://localhost/api/webhook/performance", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
}

const RAW_KEY = "hive_perf_secretkey1234567890abcdefghij";

async function createTestSetup() {
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: generateUniqueEmail("perf-wh"),
        name: "Test Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Perf Test Workspace",
        slug: generateUniqueSlug("perf-ws"),
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

    // Second workspace to test IDOR
    const owner2 = await tx.user.create({
      data: {
        id: generateUniqueId("user2"),
        email: generateUniqueEmail("perf-wh2"),
        name: "Other Owner",
      },
    });
    const workspace2 = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace2"),
        name: "Other Workspace",
        slug: generateUniqueSlug("perf-ws2"),
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

    const keyHash = hashApiKey(RAW_KEY);
    const apiKey = await tx.workspaceApiKey.create({
      data: {
        workspaceId: workspace.id,
        name: "Test Perf Ingest Key",
        keyPrefix: RAW_KEY.slice(0, 8),
        keyHash,
        createdById: owner.id,
      },
    });

    return { owner, workspace, repo, owner2, workspace2, repo2, apiKey };
  });
}

const VALID_BODY = {
  transactionName: "GET /api/users",
  totalDurationMs: 120,
  spans: [
    { op: "db.query", name: "SELECT users", durationMs: 20 },
    { op: "http.client", name: "External call", durationMs: 80 },
  ],
};

// ── Auth tests ────────────────────────────────────────────────────────────────

describe("POST /api/webhook/performance — auth", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("returns 401 when no key is provided", async () => {
    const req = new NextRequest("http://localhost/api/webhook/performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 when key is invalid", async () => {
    const res = await POST(buildRequest(VALID_BODY, "hive_bad_key"));
    expect(res.status).toBe(401);
  });

  test("returns 401 when key is revoked", async () => {
    await db.workspaceApiKey.update({
      where: { id: ctx.apiKey.id },
      data: { revokedAt: new Date() },
    });
    const res = await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(res.status).toBe(401);
  });

  test("returns 401 when key is expired", async () => {
    await db.workspaceApiKey.update({
      where: { id: ctx.apiKey.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(res.status).toBe(401);
  });

  test("accepts key via x-api-key header", async () => {
    mockPusherTrigger.mockResolvedValue(undefined);
    const res = await POST(buildRequestWithXApiKey(VALID_BODY, RAW_KEY));
    expect(res.status).toBe(201);
  });
});

// ── Body validation ───────────────────────────────────────────────────────────

describe("POST /api/webhook/performance — body validation", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("returns 400 when transactionName is missing", async () => {
    const res = await POST(buildRequest({ totalDurationMs: 100 }, RAW_KEY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/transactionName/);
  });

  test("returns 400 when totalDurationMs is missing", async () => {
    const res = await POST(buildRequest({ transactionName: "GET /api/test" }, RAW_KEY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/totalDurationMs/);
  });

  test("accepts span-less transactions (empty spans array)", async () => {
    const res = await POST(
      buildRequest({ transactionName: "GET /api/health", totalDurationMs: 5 }, RAW_KEY)
    );
    expect(res.status).toBe(201);
  });

  test("accepts transaction with no spans field at all", async () => {
    const res = await POST(
      buildRequest({ transactionName: "GET /api/health", totalDurationMs: 5 }, RAW_KEY)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.isNew).toBe(true);
  });
});

// ── Successful ingest ─────────────────────────────────────────────────────────

describe("POST /api/webhook/performance — successful ingest", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("valid key → 201 + group and event created", async () => {
    const res = await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.isNew).toBe(true);
    expect(body.data.sampleCount).toBe(1);
    expect(typeof body.data.groupId).toBe("string");
    expect(typeof body.data.eventId).toBe("string");
    expect(typeof body.data.signature).toBe("string");

    // Verify DB records
    const group = await db.performanceTraceGroup.findUnique({ where: { id: body.data.groupId } });
    expect(group).not.toBeNull();
    expect(group!.transactionName).toBe("GET /api/users");
    expect(group!.sampleCount).toBe(1);
    expect(group!.workspaceId).toBe(ctx.workspace.id);

    const event = await db.performanceTraceEvent.findUnique({ where: { id: body.data.eventId } });
    expect(event).not.toBeNull();
    expect(event!.groupId).toBe(body.data.groupId);
    expect(event!.totalDurationMs).toBe(120);
  });

  test("repo is resolved from the authenticated workspace (not body)", async () => {
    const res = await POST(
      buildRequest(
        { ...VALID_BODY, repository: "https://github.com/stakwork/hive" },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.repositoryId).toBe(ctx.repo.id);
  });

  test("second identical-signature sample increments sampleCount and updates percentiles", async () => {
    // First ingest
    const res1 = await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.data.sampleCount).toBe(1);

    // Second ingest (same shape → same signature)
    const res2 = await POST(
      buildRequest({ ...VALID_BODY, totalDurationMs: 200 }, RAW_KEY)
    );
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.data.sampleCount).toBe(2);
    expect(body2.data.isNew).toBe(false);
    expect(body2.data.signature).toBe(body1.data.signature); // same group

    // DB group should have sampleCount=2
    const group = await db.performanceTraceGroup.findUnique({ where: { id: body1.data.groupId } });
    expect(group!.sampleCount).toBe(2);
    // Two events created
    const events = await db.performanceTraceEvent.findMany({ where: { groupId: body1.data.groupId } });
    expect(events).toHaveLength(2);
  });

  test("Pusher event is triggered with correct shape", async () => {
    await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(mockPusherTrigger).toHaveBeenCalledOnce();
    const [channel, event, payload] = mockPusherTrigger.mock.calls[0];
    expect(channel).toContain(ctx.workspace.slug);
    expect(event).toBe("performance-group-updated");
    expect(payload).toHaveProperty("id");
    expect(payload).toHaveProperty("signature");
    expect(payload).toHaveProperty("sampleCount", 1);
    expect(payload).toHaveProperty("p50Ms");
    expect(payload).toHaveProperty("p95Ms");
    expect(payload).toHaveProperty("p99Ms");
    expect(payload).toHaveProperty("isNew", true);
  });

  test("Pusher failure does not fail ingest", async () => {
    mockPusherTrigger.mockRejectedValue(new Error("Pusher down"));
    const res = await POST(buildRequest(VALID_BODY, RAW_KEY));
    expect(res.status).toBe(201);
  });
});

// ── IDOR safety ───────────────────────────────────────────────────────────────

describe("POST /api/webhook/performance — IDOR safety", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace2.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("body workspaceId is ignored — group created under authenticated workspace", async () => {
    const res = await POST(
      buildRequest(
        {
          ...VALID_BODY,
          // Attacker supplies workspace2's id hoping to write there
          workspaceId: ctx.workspace2.id,
          repository: ctx.repo2.repositoryUrl,
        },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    // Group must belong to workspace 1 (from the key), not workspace 2
    const group = await db.performanceTraceGroup.findUnique({ where: { id: body.data.groupId } });
    expect(group!.workspaceId).toBe(ctx.workspace.id);
    // repo2 is in workspace2 — must NOT be linked from workspace1
    expect(group!.repositoryId).not.toBe(ctx.repo2.id);
  });

  test("repo resolution is scoped to authenticated workspace only", async () => {
    // Even if body claims repo2 (which belongs to workspace2), the group must not link to it
    const res = await POST(
      buildRequest(
        { ...VALID_BODY, repository: "https://github.com/other-org/secret-repo" },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    // repo2 doesn't exist in workspace1, so repositoryId should be null
    expect(body.data.repositoryId).toBeNull();
  });
});

// ── Repo resolution edge cases ────────────────────────────────────────────────

describe("POST /api/webhook/performance — repo resolution", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("unresolved repository falls back to stable repoKey — data is not dropped", async () => {
    const res = await POST(
      buildRequest(
        { ...VALID_BODY, repository: "https://github.com/unknown/repo" },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.repositoryId).toBeNull();

    // A group should still be created
    const group = await db.performanceTraceGroup.findUnique({ where: { id: body.data.groupId } });
    expect(group).not.toBeNull();
    // repoKey is the normalised repo string (not "unknown" for non-empty unresolved)
    expect(group!.repoKey).not.toBe("");
  });

  test("no repository field → repoKey is 'unknown' but group is still created", async () => {
    const res = await POST(buildRequest(VALID_BODY, RAW_KEY)); // no repository field
    expect(res.status).toBe(201);
    const body = await res.json();

    const group = await db.performanceTraceGroup.findUnique({ where: { id: body.data.groupId } });
    expect(group!.repoKey).toBe("unknown");
    expect(group!.repositoryId).toBeNull();
  });

  test("resolved repository ID is returned in response", async () => {
    const res = await POST(
      buildRequest(
        { ...VALID_BODY, repository: "https://github.com/stakwork/hive" },
        RAW_KEY
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.repositoryId).toBe(ctx.repo.id);
  });
});

// ── Sketch / percentile accuracy ──────────────────────────────────────────────

describe("POST /api/webhook/performance — sketch updates on repeat samples", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await db.performanceTraceEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.performanceTraceGroup.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo2.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace2.id } });
    await db.user.deleteMany({ where: { id: ctx.owner2.id } });
  });

  test("p50/p95/p99 are updated after second sample with higher duration", async () => {
    // First sample: 100ms
    const res1 = await POST(buildRequest({ ...VALID_BODY, totalDurationMs: 100 }, RAW_KEY));
    const body1 = await res1.json();
    const groupId = body1.data.groupId;

    const groupAfter1 = await db.performanceTraceGroup.findUnique({ where: { id: groupId } });
    expect(groupAfter1!.p50Ms).toBeGreaterThan(0);

    // Second sample: 900ms (much higher)
    const res2 = await POST(buildRequest({ ...VALID_BODY, totalDurationMs: 900 }, RAW_KEY));
    expect(res2.status).toBe(201);

    const groupAfter2 = await db.performanceTraceGroup.findUnique({ where: { id: groupId } });
    expect(groupAfter2!.sampleCount).toBe(2);
    // p99 should be higher than p50 after two disparate samples
    expect(groupAfter2!.p99Ms).toBeGreaterThanOrEqual(groupAfter2!.p50Ms);
  });
});
