/**
 * Integration tests for the Errors read/triage API
 *
 * Routes:
 *   GET  /api/errors
 *   GET  /api/errors/[issueId]
 *   GET  /api/errors/[issueId]/events/[eventId]/blob
 *   PATCH /api/errors/[issueId]
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateUniqueId, generateUniqueSlug, generateUniqueEmail } from "@/__tests__/support/helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockRequireAuth, mockPusherTrigger, mockFetchBlob } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPusherTrigger: vi.fn(),
  mockFetchBlob: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn((req: NextRequest) => ({ user: null })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: { trigger: mockPusherTrigger },
  };
});

vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: mockFetchBlob,
}));

import { GET as listErrors } from "@/app/api/errors/route";
import { GET as getIssue, PATCH as patchIssue } from "@/app/api/errors/[issueId]/route";
import { GET as getBlob } from "@/app/api/errors/[issueId]/events/[eventId]/blob/route";

// ── Test data setup ───────────────────────────────────────────────────────────

async function createTestSetup() {
  // Workspace A — for the authenticated user
  const ownerA = await db.user.create({
    data: {
      id: generateUniqueId("user-a"),
      email: generateUniqueEmail("errors-api-a"),
      name: "Owner A",
    },
  });
  const workspaceA = await db.workspace.create({
    data: {
      id: generateUniqueId("ws-a"),
      name: "Workspace A",
      slug: generateUniqueSlug("errors-ws-a"),
      ownerId: ownerA.id,
    },
  });
  const repoA = await db.repository.create({
    data: {
      id: generateUniqueId("repo-a"),
      name: "hive",
      repositoryUrl: "https://github.com/stakwork/hive",
      branch: "master",
      workspaceId: workspaceA.id,
    },
  });

  // Workspace B — for IDOR tests (different user/workspace)
  const ownerB = await db.user.create({
    data: {
      id: generateUniqueId("user-b"),
      email: generateUniqueEmail("errors-api-b"),
      name: "Owner B",
    },
  });
  const workspaceB = await db.workspace.create({
    data: {
      id: generateUniqueId("ws-b"),
      name: "Workspace B",
      slug: generateUniqueSlug("errors-ws-b"),
      ownerId: ownerB.id,
    },
  });

  // Issues in workspace A
  const now = new Date();
  const issueA1 = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-a1"),
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: repoA.id,
      fingerprint: `fp-${generateUniqueId()}`,
      exceptionType: "TypeError",
      title: "TypeError: cannot read property x of undefined",
      occurrenceCount: 10,
      firstSeenAt: now,
      lastSeenAt: now,
      environment: "production",
      status: "UNRESOLVED",
    },
  });
  const issueA2 = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-a2"),
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: repoA.id,
      fingerprint: `fp-${generateUniqueId()}`,
      exceptionType: "ReferenceError",
      title: "ReferenceError: foo is not defined",
      occurrenceCount: 3,
      firstSeenAt: now,
      lastSeenAt: new Date(now.getTime() - 1000),
      environment: "staging",
      status: "RESOLVED",
    },
  });

  // Issue in workspace B — must not be accessible to ownerA
  const issueB = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-b"),
      workspaceId: workspaceB.id,
      repoKey: "repo-b",
      fingerprint: `fp-${generateUniqueId()}`,
      exceptionType: "Error",
      title: "Secret error in workspace B",
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "UNRESOLVED",
    },
  });

  // Event for issueA1
  const eventA1 = await db.errorEvent.create({
    data: {
      id: generateUniqueId("event-a1"),
      issueId: issueA1.id,
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: repoA.id,
      blobUrl: "https://abc.blob.vercel-storage.com/errors/test-event.json",
      exceptionType: "TypeError",
      message: "cannot read property x of undefined",
      fingerprint: issueA1.fingerprint,
      commitSha: "deadbeef1234567890abcdef1234567890abcdef",
    },
  });

  return {
    ownerA,
    workspaceA,
    repoA,
    ownerB,
    workspaceB,
    issueA1,
    issueA2,
    issueB,
    eventA1,
  };
}

// ── Request builders ──────────────────────────────────────────────────────────

function buildGetRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "GET" });
}

function buildPatchRequest(url: string, body: object): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Teardown helpers ──────────────────────────────────────────────────────────

async function cleanupSetup(ctx: Awaited<ReturnType<typeof createTestSetup>>) {
  await db.errorEvent.deleteMany({
    where: { id: { in: [ctx.eventA1.id] } },
  });
  await db.errorIssue.deleteMany({
    where: { id: { in: [ctx.issueA1.id, ctx.issueA2.id, ctx.issueB.id] } },
  });
  await db.repository.deleteMany({ where: { id: ctx.repoA.id } });
  await db.workspace.deleteMany({ where: { id: { in: [ctx.workspaceA.id, ctx.workspaceB.id] } } });
  await db.user.deleteMany({ where: { id: { in: [ctx.ownerA.id, ctx.ownerB.id] } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/errors
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/errors", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await cleanupSetup(ctx);
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}`);
    const res = await listErrors(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 when workspace_id is missing", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest("/api/errors");
    const res = await listErrors(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 when user has no access to workspace", async () => {
    // ownerB tries to access workspaceA
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerB.id, email: ctx.ownerB.email, name: ctx.ownerB.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}`);
    const res = await listErrors(req);
    expect(res.status).toBe(404);
  });

  test("returns list of issues for authenticated owner", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    // Use status=all to fetch every issue regardless of status
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&status=all`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThanOrEqual(2);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&status=RESOLVED`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues.every((i: { status: string }) => i.status === "RESOLVED")).toBe(true);
  });

  test("filters by repoKey", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&repoKey=${ctx.repoA.id}`,
    );
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues.every((i: { repoKey: string }) => i.repoKey === ctx.repoA.id)).toBe(true);
  });

  test("respects pagination: skip and limit", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&limit=1&skip=0`,
    );
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues.length).toBe(1);
    expect(typeof body.hasMore).toBe("boolean");
  });

  test("returns 400 for invalid status", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&status=OPEN`,
    );
    const res = await listErrors(req);
    expect(res.status).toBe(400);
  });

  test("default (no status param) returns only active issues, excluding RESOLVED/IGNORED", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    // issueA1 = UNRESOLVED, issueA2 = RESOLVED — only A1 should appear
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.issues.map((i: { id: string }) => i.id);
    expect(ids).toContain(ctx.issueA1.id);
    expect(ids).not.toContain(ctx.issueA2.id); // RESOLVED — excluded from default view
    expect(body.total).not.toBeGreaterThan(1);  // total reflects filtered set
  });

  test("status=all returns every issue regardless of status", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&status=all`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.issues.map((i: { id: string }) => i.id);
    expect(ids).toContain(ctx.issueA1.id);
    expect(ids).toContain(ctx.issueA2.id); // RESOLVED — included when all requested
  });

  test("status=ALL (uppercase) also returns all issues (case-insensitive)", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&status=ALL`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.issues.map((i: { id: string }) => i.id);
    expect(ids).toContain(ctx.issueA1.id);
    expect(ids).toContain(ctx.issueA2.id);
  });

  test("issues are ordered by lastSeenAt desc", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    // Use status=all so both UNRESOLVED and RESOLVED issues are present for ordering check
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&status=all`);
    const res = await listErrors(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    // issueA1 has newer lastSeenAt than issueA2
    const ids = body.issues.map((i: { id: string }) => i.id);
    const a1Idx = ids.indexOf(ctx.issueA1.id);
    const a2Idx = ids.indexOf(ctx.issueA2.id);
    expect(a1Idx).toBeLessThan(a2Idx);
  });

  test("returns 400 for invalid sort value", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&sort=popularity`,
    );
    const res = await listErrors(req);
    expect(res.status).toBe(400);
  });

  test("sort=recent is accepted and returns 200", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&sort=recent&status=all`);
    const res = await listErrors(req);
    expect(res.status).toBe(200);
  });

  test("sort=impact is accepted and returns 200", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors?workspace_id=${ctx.workspaceA.id}&sort=impact&status=all`);
    const res = await listErrors(req);
    expect(res.status).toBe(200);
  });

  test("sort=impact orders high-impact issue before null-impact issue", async () => {
    // Create two additional issues: one with high impact score, one without
    const now = new Date();
    const highImpactIssue = await db.errorIssue.create({
      data: {
        id: generateUniqueId("issue-hi"),
        workspaceId: ctx.workspaceA.id,
        repositoryId: ctx.repoA.id,
        repoKey: ctx.repoA.id,
        fingerprint: `fp-hi-${generateUniqueId()}`,
        exceptionType: "TypeError",
        title: "High impact error",
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        status: "UNRESOLVED",
        impactScore: 0.9,
        impactScoredAt: now,
      },
    });
    const nullImpactIssue = await db.errorIssue.create({
      data: {
        id: generateUniqueId("issue-null"),
        workspaceId: ctx.workspaceA.id,
        repositoryId: ctx.repoA.id,
        repoKey: ctx.repoA.id,
        fingerprint: `fp-null-${generateUniqueId()}`,
        exceptionType: "ReferenceError",
        title: "Unscored error",
        occurrenceCount: 999, // many occurrences but no impact score
        firstSeenAt: now,
        lastSeenAt: now,
        status: "UNRESOLVED",
        impactScore: null,
      },
    });

    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&sort=impact&status=UNRESOLVED`,
    );
    const res = await listErrors(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: string[] = body.issues.map((i: { id: string }) => i.id);

    const hiIdx = ids.indexOf(highImpactIssue.id);
    const nullIdx = ids.indexOf(nullImpactIssue.id);
    // High impact must appear before null (nulls last)
    expect(hiIdx).toBeGreaterThanOrEqual(0);
    expect(nullIdx).toBeGreaterThanOrEqual(0);
    expect(hiIdx).toBeLessThan(nullIdx);

    // Cleanup
    await db.errorIssue.deleteMany({ where: { id: { in: [highImpactIssue.id, nullImpactIssue.id] } } });
  });

  test("sort=impact exposes impactScore/impactScoredAt/impactMeta in response", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(
      `/api/errors?workspace_id=${ctx.workspaceA.id}&sort=impact&status=all`,
    );
    const res = await listErrors(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // All issues should have these fields present (may be null)
    for (const issue of body.issues) {
      expect(issue).toHaveProperty("impactScore");
      expect(issue).toHaveProperty("impactScoredAt");
      expect(issue).toHaveProperty("impactMeta");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/errors/[issueId]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/errors/[issueId]", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await cleanupSetup(ctx);
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = buildGetRequest(`/api/errors/${ctx.issueA1.id}`);
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(401);
  });

  test("returns issue with events for authenticated owner", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors/${ctx.issueA1.id}`);
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue.id).toBe(ctx.issueA1.id);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.eventsTotal).toBe("number");
  });

  test("returns 404 for non-existent issue (avoids existence leak)", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest("/api/errors/nonexistent-issue-id");
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: "nonexistent-issue-id" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 when user from workspace B accesses workspace A issue (IDOR)", async () => {
    // ownerB should not be able to see issueA1
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerB.id, email: ctx.ownerB.email, name: ctx.ownerB.name });
    const req = buildGetRequest(`/api/errors/${ctx.issueA1.id}`);
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(404);
  });

  test("includes recent events ordered newest first", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors/${ctx.issueA1.id}`);
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(1);
    expect(body.events[0].id).toBe(ctx.eventA1.id);
  });

  test("event includes commitSha, repositoryUrl, and defaultBranch", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildGetRequest(`/api/errors/${ctx.issueA1.id}`);
    const res = await getIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const event = body.events[0];
    expect(event.commitSha).toBe("deadbeef1234567890abcdef1234567890abcdef");
    expect(event.repositoryUrl).toBe("https://github.com/stakwork/hive");
    expect(event.defaultBranch).toBe("master");
    // raw nested repository should not be exposed
    expect(event.repository).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/errors/[issueId]/events/[eventId]/blob
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/errors/[issueId]/events/[eventId]/blob", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
  });

  afterEach(async () => {
    await cleanupSetup(ctx);
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${ctx.eventA1.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: ctx.eventA1.id }),
    });
    expect(res.status).toBe(401);
  });

  test("returns blob content for authenticated owner", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    mockFetchBlob.mockResolvedValueOnce(JSON.stringify({ exceptionType: "TypeError", message: "oops" }));

    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${ctx.eventA1.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: ctx.eventA1.id }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).toContain("TypeError");
  });

  test("redacts authorization header in blob content", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const blobPayload = JSON.stringify({
      exceptionType: "TypeError",
      requestContext: {
        headers: {
          authorization: "Bearer super-secret-token",
          cookie: "session=abc123",
          "x-api-key": "sk-abc",
          "content-type": "application/json",
        },
      },
    });
    mockFetchBlob.mockResolvedValueOnce(blobPayload);

    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${ctx.eventA1.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: ctx.eventA1.id }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("session=abc123");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("application/json"); // non-sensitive key preserved
  });

  test("returns 404 when event does not belong to the issue (IDOR)", async () => {
    // Create an event belonging to issueA2, then try to fetch it via issueA1
    const alienEvent = await db.errorEvent.create({
      data: {
        id: generateUniqueId("alien-event"),
        issueId: ctx.issueA2.id,
        workspaceId: ctx.workspaceA.id,
        repoKey: ctx.repoA.id,
        blobUrl: "https://abc.blob.vercel-storage.com/alien.json",
        exceptionType: "Error",
        message: "alien error",
        fingerprint: ctx.issueA2.fingerprint,
      },
    });

    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });

    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${alienEvent.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: alienEvent.id }),
    });

    expect(res.status).toBe(404);

    await db.errorEvent.delete({ where: { id: alienEvent.id } });
  });

  test("returns 404 when user from workspace B accesses workspace A event (IDOR)", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerB.id, email: ctx.ownerB.email, name: ctx.ownerB.name });
    // No blob mock needed: auth check fails before the blob is ever fetched.

    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${ctx.eventA1.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: ctx.eventA1.id }),
    });

    expect(res.status).toBe(404);
  });

  test("degrades gracefully when blob fetch fails (returns 502)", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    mockFetchBlob.mockRejectedValueOnce(new Error("Blob unavailable"));

    const req = buildGetRequest(
      `/api/errors/${ctx.issueA1.id}/events/${ctx.eventA1.id}/blob`,
    );
    const res = await getBlob(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id, eventId: ctx.eventA1.id }),
    });

    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/errors/[issueId]
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/errors/[issueId]", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupSetup(ctx);
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "RESOLVED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 400 for invalid status value", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "OPEN" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing status", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, {});
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent issue", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest("/api/errors/nonexistent-id", { status: "RESOLVED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 when user from workspace B tries to triage workspace A issue (IDOR)", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerB.id, email: ctx.ownerB.email, name: ctx.ownerB.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "RESOLVED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });
    expect(res.status).toBe(404);
  });

  test("successfully resolves an issue", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "RESOLVED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("RESOLVED");

    // Verify DB was updated
    const updated = await db.errorIssue.findUnique({ where: { id: ctx.issueA1.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  test("successfully ignores an issue", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "IGNORED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("IGNORED");
  });

  test("successfully reopens a resolved issue to UNRESOLVED", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA2.id}`, { status: "UNRESOLVED" });
    const res = await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA2.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("UNRESOLVED");
  });

  test("broadcasts Pusher event on status change", async () => {
    mockRequireAuth.mockReturnValueOnce({ id: ctx.ownerA.id, email: ctx.ownerA.email, name: ctx.ownerA.name });
    const req = buildPatchRequest(`/api/errors/${ctx.issueA1.id}`, { status: "RESOLVED" });
    await patchIssue(req, {
      params: Promise.resolve({ issueId: ctx.issueA1.id }),
    });

    expect(mockPusherTrigger).toHaveBeenCalledWith(
      expect.stringContaining(ctx.workspaceA.slug),
      "error-issue-updated",
      expect.objectContaining({
        id: ctx.issueA1.id,
        isNew: false,
        status: "RESOLVED",
      }),
    );
  });
});
