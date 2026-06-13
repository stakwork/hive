/**
 * Integration tests for POST /api/workspaces/[slug]/workflows/[workflowId]/summarise
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  generateUniqueSlug,
  generateUniqueEmail,
} from "@/__tests__/support/helpers";
import {
  createAuthenticatedSession,
  mockSessionAs,
} from "@/__tests__/support/helpers/auth";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("next-auth/next", async () => {
  const actual = await vi.importActual("next-auth/next");
  return { ...actual, getServerSession: vi.fn() };
});

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

// Replace global fetch with our mock
vi.stubGlobal("fetch", mockFetch);

// Import route handler after mocks
import { POST } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/summarise/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(slug: string, workflowId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/summarise`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function createTestSetup() {
  const owner = await db.user.create({
    data: {
      id: generateUniqueId("user"),
      email: generateUniqueEmail("wf-sum"),
      name: "Test Owner",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      id: generateUniqueId("workspace"),
      name: "Test Workspace",
      slug: generateUniqueSlug("wf-sum-ws"),
      ownerId: owner.id,
    },
  });

  return { owner, workspace };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflows/[workflowId]/summarise", () => {
  let testData: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.USE_MOCKS = "false";
    process.env.STAKWORK_WORKFLOW_SUMMARY_WORKFLOW_ID = "12345";
    process.env.NEXTAUTH_SECRET = "test-secret";

    // Default fetch mock — Stakwork returns success
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { project_id: 42 } }),
    });

    testData = await createTestSetup();
  });

  afterEach(async () => {
    const { workspace, owner } = testData;
    await db.workflowSummary.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.deleteMany({ where: { id: workspace.id } });
    await db.user.deleteMany({ where: { id: owner.id } });
  });

  test("returns 401 when unauthenticated", async () => {
    mockSessionAs(null);
    const req = buildRequest(testData.workspace.slug, "100", { versionIds: ["1", "2"] });
    const res = await POST(req, { params: Promise.resolve({ slug: testData.workspace.slug, workflowId: "100" }) });
    expect(res.status).toBe(401);
  });

  test("returns 404 when user is not workspace owner or member (IDOR guard)", async () => {
    const outsider = await db.user.create({
      data: {
        id: generateUniqueId("outsider"),
        email: generateUniqueEmail("outsider"),
        name: "Outsider",
      },
    });

    try {
      mockSessionAs(createAuthenticatedSession(outsider));

      const req = buildRequest(testData.workspace.slug, "100", { versionIds: ["1", "2"] });
      const res = await POST(req, { params: Promise.resolve({ slug: testData.workspace.slug, workflowId: "100" }) });
      expect(res.status).toBe(404);
    } finally {
      await db.user.deleteMany({ where: { id: outsider.id } });
    }
  });

  test("returns 400 when versionIds has fewer than 2 items", async () => {
    mockSessionAs(createAuthenticatedSession(testData.owner));

    const req = buildRequest(testData.workspace.slug, "100", { versionIds: ["1"] });
    const res = await POST(req, { params: Promise.resolve({ slug: testData.workspace.slug, workflowId: "100" }) });
    expect(res.status).toBe(400);
  });

  test("returns 400 when versionIds has more than 5 items", async () => {
    mockSessionAs(createAuthenticatedSession(testData.owner));

    const req = buildRequest(testData.workspace.slug, "100", {
      versionIds: ["1", "2", "3", "4", "5", "6"],
    });
    const res = await POST(req, { params: Promise.resolve({ slug: testData.workspace.slug, workflowId: "100" }) });
    expect(res.status).toBe(400);
  });

  test("first call: creates WorkflowSummary with PENDING status, calls Stakwork, returns cached: false", async () => {
    mockSessionAs(createAuthenticatedSession(testData.owner));

    const versionIds = ["10", "20"];
    const req = buildRequest(testData.workspace.slug, "100", { versionIds });
    const res = await POST(req, { params: Promise.resolve({ slug: testData.workspace.slug, workflowId: "100" }) });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.summaryId).toBeTruthy();

    // Verify DB record
    const record = await db.workflowSummary.findUnique({ where: { id: body.summaryId } });
    expect(record).toBeTruthy();
    expect(record?.status).toBe("PENDING");
    expect(record?.workspaceId).toBe(testData.workspace.id);

    // Verify Stakwork was called
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  test("second call with same version IDs (different order): hits cache, returns cached: true without calling Stakwork", async () => {
    mockSessionAs(createAuthenticatedSession(testData.owner));

    const { workspace } = testData;
    const workflowIdNum = 200;

    // Seed a COMPLETE summary directly
    const versionIds = ["30", "40"];
    const cacheKey = require("crypto")
      .createHash("sha256")
      .update([...versionIds].sort().join(","))
      .digest("hex")
      .slice(0, 16);

    await db.workflowSummary.create({
      data: {
        workflowId: workflowIdNum,
        workspaceId: workspace.id,
        cacheKey,
        versionIds,
        status: "COMPLETE",
        content: "Cached summary content",
      },
    });

    // Call with IDs in reversed order — cache key should be the same
    const req = buildRequest(workspace.slug, String(workflowIdNum), {
      versionIds: ["40", "30"],
    });
    const res = await POST(req, {
      params: Promise.resolve({ slug: workspace.slug, workflowId: String(workflowIdNum) }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.content).toBe("Cached summary content");

    // Stakwork should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
