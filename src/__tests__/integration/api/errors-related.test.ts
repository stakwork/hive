/**
 * Integration tests for GET /api/errors/[issueId]/related
 *
 * Covers:
 * - 401 when unauthenticated
 * - 404 when issue doesn't exist
 * - 404 (IDOR) when user lacks workspace access
 * - { related: [] } on graph/service failure (never 500)
 * - Properly scoped and ranked results for authorized user
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  generateUniqueSlug,
  generateUniqueEmail,
} from "@/__tests__/support/helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockGetJarvisConfig,
  mockKgGetNeighbors,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockKgGetNeighbors: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn((req: NextRequest) => ({ user: null })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNeighbors: mockKgGetNeighbors,
}));

import { GET } from "@/app/api/errors/[issueId]/related/route";
import { NextResponse } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(issueId: string): NextRequest {
  return new NextRequest(`http://localhost/api/errors/${issueId}/related`);
}

function buildContext(issueId: string) {
  return { params: Promise.resolve({ issueId }) };
}

const makeKgNeighbor = (ref_id: string, node_type = "File") => ({
  ref_id,
  node_type,
  name: ref_id,
  direction: "forward" as const,
  title: ref_id,
});

// ── Test setup ────────────────────────────────────────────────────────────────

async function createTestSetup() {
  const ownerA = await db.user.create({
    data: {
      id: generateUniqueId("user-related-a"),
      email: generateUniqueEmail("errors-related-a"),
      name: "Owner A",
    },
  });
  const workspaceA = await db.workspace.create({
    data: {
      id: generateUniqueId("ws-related-a"),
      name: "Workspace A",
      slug: generateUniqueSlug("errors-related-a"),
      ownerId: ownerA.id,
    },
  });
  const repoA = await db.repository.create({
    data: {
      id: generateUniqueId("repo-related-a"),
      name: "hive",
      repositoryUrl: "https://github.com/stakwork/hive",
      branch: "master",
      workspaceId: workspaceA.id,
    },
  });

  // Workspace B for IDOR tests
  const ownerB = await db.user.create({
    data: {
      id: generateUniqueId("user-related-b"),
      email: generateUniqueEmail("errors-related-b"),
      name: "Owner B",
    },
  });
  const workspaceB = await db.workspace.create({
    data: {
      id: generateUniqueId("ws-related-b"),
      name: "Workspace B",
      slug: generateUniqueSlug("errors-related-b"),
      ownerId: ownerB.id,
    },
  });

  const now = new Date();

  // Source issue in workspace A with a kgRefId
  const sourceIssue = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-src"),
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: "stakwork/hive",
      fingerprint: `fp-src-${generateUniqueId()}`,
      exceptionType: "TypeError",
      title: "Source error",
      occurrenceCount: 10,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "UNRESOLVED",
      kgRefId: "kg-ref-src",
    },
  });

  // Sibling issue (UNRESOLVED) in same workspace + repo
  const siblingUnresolved = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-sib-unresolved"),
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: "stakwork/hive",
      fingerprint: `fp-sib-u-${generateUniqueId()}`,
      exceptionType: "ReferenceError",
      title: "Sibling unresolved error",
      occurrenceCount: 5,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "UNRESOLVED",
      kgRefId: "kg-ref-sib-unresolved",
    },
  });

  // Sibling issue (RESOLVED) in same workspace + repo
  const siblingResolved = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-sib-resolved"),
      workspaceId: workspaceA.id,
      repositoryId: repoA.id,
      repoKey: "stakwork/hive",
      fingerprint: `fp-sib-r-${generateUniqueId()}`,
      exceptionType: "RangeError",
      title: "Sibling resolved error",
      occurrenceCount: 2,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "RESOLVED",
      kgRefId: "kg-ref-sib-resolved",
    },
  });

  // Issue in workspace B (should never appear in results)
  const issueB = await db.errorIssue.create({
    data: {
      id: generateUniqueId("issue-b"),
      workspaceId: workspaceB.id,
      repoKey: "other/repo",
      fingerprint: `fp-b-${generateUniqueId()}`,
      exceptionType: "Error",
      title: "Other workspace error",
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "UNRESOLVED",
      kgRefId: "kg-ref-b",
    },
  });

  return { ownerA, ownerB, workspaceA, workspaceB, repoA, sourceIssue, siblingUnresolved, siblingResolved, issueB };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/errors/[issueId]/related", () => {
  let setup: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    setup = await createTestSetup();
    mockGetJarvisConfig.mockResolvedValue(null); // default: no jarvis = empty related
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });
  });

  afterEach(async () => {
    // Clean up test data
    const { sourceIssue, siblingUnresolved, siblingResolved, issueB, workspaceA, workspaceB, ownerA, ownerB } = setup;
    await db.errorIssue.deleteMany({
      where: { id: { in: [sourceIssue.id, siblingUnresolved.id, siblingResolved.id, issueB.id] } },
    });
    await db.workspace.deleteMany({ where: { id: { in: [workspaceA.id, workspaceB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(buildRequest(setup.sourceIssue.id), buildContext(setup.sourceIssue.id));
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent issue", async () => {
    mockRequireAuth.mockReturnValue({ id: setup.ownerA.id });
    const res = await GET(buildRequest("nonexistent-id"), buildContext("nonexistent-id"));
    expect(res.status).toBe(404);
  });

  test("returns 404 (IDOR) when user is not a member of the issue's workspace", async () => {
    // ownerB tries to access ownerA's issue
    mockRequireAuth.mockReturnValue({ id: setup.ownerB.id });
    const res = await GET(
      buildRequest(setup.sourceIssue.id),
      buildContext(setup.sourceIssue.id),
    );
    expect(res.status).toBe(404);
  });

  test("returns { related: [] } when graph is unavailable (never 500)", async () => {
    mockRequireAuth.mockReturnValue({ id: setup.ownerA.id });
    // jarvis config present but kgGetNeighbors throws
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://jarvis.example.com", apiKey: "key" });
    mockKgGetNeighbors.mockRejectedValue(new Error("graph unavailable"));

    const res = await GET(buildRequest(setup.sourceIssue.id), buildContext(setup.sourceIssue.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ related: [] });
  });

  test("returns { related: [] } when no jarvis config", async () => {
    mockRequireAuth.mockReturnValue({ id: setup.ownerA.id });
    mockGetJarvisConfig.mockResolvedValue(null);

    const res = await GET(buildRequest(setup.sourceIssue.id), buildContext(setup.sourceIssue.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ related: [] });
  });

  test("returns properly scoped and ranked results for authorized user", async () => {
    mockRequireAuth.mockReturnValue({ id: setup.ownerA.id });
    mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://jarvis.example.com", apiKey: "key" });

    // Hop 1: one shared code node
    const codeNode = makeKgNeighbor("file-shared");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode], reachable: true }) // hop-1
      .mockResolvedValueOnce({
        // hop-2 for file-shared: returns both siblings + source (source must be excluded)
        neighbors: [
          makeKgNeighbor("kg-ref-src", "ErrorIssue"), // source — excluded
          makeKgNeighbor("kg-ref-sib-unresolved", "ErrorIssue"),
          makeKgNeighbor("kg-ref-sib-resolved", "ErrorIssue"),
          makeKgNeighbor("kg-ref-b", "ErrorIssue"), // other workspace — scoped out by DB query
        ],
        reachable: true,
      });

    const res = await GET(buildRequest(setup.sourceIssue.id), buildContext(setup.sourceIssue.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Both sibling issues should appear (workspace B issue scoped out by DB)
    expect(body.related).toHaveLength(2);

    // Unresolved should rank first
    expect(body.related[0].status).toBe("UNRESOLVED");
    expect(body.related[1].status).toBe("RESOLVED");

    // Each result should have the expected shape
    const first = body.related[0];
    expect(first).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      exceptionType: expect.any(String),
      status: "UNRESOLVED",
      occurrenceCount: expect.any(Number),
      lastSeenAt: expect.any(String),
      sharedCodeNodeCount: 1,
    });
  });
});
