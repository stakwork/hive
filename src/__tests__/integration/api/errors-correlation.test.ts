/**
 * Integration tests for regression correlation wiring in POST /api/webhook/errors
 *
 * Verifies that:
 * - Correlation is invoked (non-blocking) on onset events (new / regression / burst)
 * - Ingest returns 201 even when KG calls in correlateErrorIssue throw/reject
 * - Ingest returns 201 even when detectOnset throws
 * - Correlation is NOT attempted when onset is not detected (no burst/new/regression)
 *
 * These tests mock spike-detection and correlate modules to isolate the wiring.
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
  mockSearchLatestByTypes,
  mockGetJarvisConfig,
  mockDetectOnset,
  mockCorrelateErrorIssue,
} = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
  mockAddNode: vi.fn(),
  mockAddEdge: vi.fn(),
  mockSearchLatestByTypes: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockDetectOnset: vi.fn(),
  mockCorrelateErrorIssue: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: { trigger: mockPusherTrigger },
  };
});

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/error-event.json" }),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
  searchLatestByTypes: mockSearchLatestByTypes,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/services/error-issues/spike-detection", () => ({
  detectOnset: mockDetectOnset,
}));

vi.mock("@/services/error-issues/correlate", () => ({
  correlateErrorIssue: mockCorrelateErrorIssue,
}));

import { POST } from "@/app/api/webhook/errors/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: Record<string, unknown>, key: string): NextRequest {
  return new NextRequest("http://localhost/api/webhook/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

const RAW_KEY = "hive_correltest_secretkey1234567890abcd";
const MOCK_JARVIS_CONFIG = { jarvisUrl: "http://jarvis.test:8444", swarmApiKey: "jarvis-secret" };

async function createTestSetup() {
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: generateUniqueEmail("corr-wh"),
        name: "Corr Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Corr Workspace",
        slug: generateUniqueSlug("corr-ws"),
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

    const keyHash = hashApiKey(RAW_KEY);
    const apiKey = await tx.workspaceApiKey.create({
      data: {
        workspaceId: workspace.id,
        name: "corr-test-key",
        keyHash,
        keyPrefix: RAW_KEY.slice(0, 8),
        createdById: owner.id,
      },
    });

    return { owner, workspace, repo, apiKey };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/errors — correlation wiring", () => {
  let ctx: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createTestSetup();
    mockPusherTrigger.mockResolvedValue(undefined);
    // Default KG projection: succeeds silently
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "issue-kg-ref" });
    mockSearchLatestByTypes.mockResolvedValue({ ok: true, nodes: [] });
    // Default: onset detected (new issue)
    mockDetectOnset.mockResolvedValue({ isOnset: true, reason: "new" });
    // Default: correlation resolves quietly
    mockCorrelateErrorIssue.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await db.errorEvent.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.errorIssue.deleteMany({ where: { workspaceId: ctx.workspace.id } });
    await db.workspaceApiKey.deleteMany({ where: { id: ctx.apiKey.id } });
    await db.repository.deleteMany({ where: { id: ctx.repo.id } });
    await db.workspace.deleteMany({ where: { id: ctx.workspace.id } });
    await db.user.deleteMany({ where: { id: ctx.owner.id } });
  });

  test("201 returned when correlateErrorIssue throws — ingest is unblocked", async () => {
    // correlateErrorIssue rejects — must not surface in response
    mockCorrelateErrorIssue.mockRejectedValue(new Error("KG explosion"));

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "boom", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("201 returned when detectOnset throws — ingest is unblocked", async () => {
    mockDetectOnset.mockRejectedValue(new Error("DB meltdown in spike detection"));

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "boom", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("correlateErrorIssue is NOT called when detectOnset returns isOnset=false", async () => {
    mockDetectOnset.mockResolvedValue({ isOnset: false, reason: null });

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "no burst", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    // Give any fire-and-forget promises a tick to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mockCorrelateErrorIssue).not.toHaveBeenCalled();
  });

  test("correlateErrorIssue is called when onset is detected (isOnset=true)", async () => {
    mockDetectOnset.mockResolvedValue({ isOnset: true, reason: "new" });

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "first occurrence", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    // Allow the fire-and-forget correlateErrorIssue promise to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCorrelateErrorIssue).toHaveBeenCalledOnce();
    const [issueId, kgRefId, , commitSha, jarvisConfig, reason] =
      mockCorrelateErrorIssue.mock.calls[0];
    expect(typeof issueId).toBe("string");
    expect(kgRefId).toBe("issue-kg-ref"); // set by mocked addNode
    expect(commitSha).toBeNull(); // no commitSha in request body
    expect(jarvisConfig).toMatchObject({ jarvisUrl: MOCK_JARVIS_CONFIG.jarvisUrl });
    expect(reason).toBe("new");
  });

  test("correlateErrorIssue is NOT called when no jarvis config is available", async () => {
    mockGetJarvisConfig.mockResolvedValue(null);
    mockDetectOnset.mockResolvedValue({ isOnset: true, reason: "new" });

    const res = await POST(
      buildRequest(
        { exceptionType: "TypeError", message: "no jarvis", repository: "https://github.com/stakwork/hive" },
        RAW_KEY,
      ),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCorrelateErrorIssue).not.toHaveBeenCalled();
  });
});
