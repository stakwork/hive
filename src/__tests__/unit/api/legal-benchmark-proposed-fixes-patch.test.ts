/**
 * Unit tests for:
 * 1. PATCH /api/workspaces/[slug]/legal/benchmarks/proposed-fixes/[refId]
 *    (accept/reject mutation route)
 * 2. GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes
 *    — status filter regression (rejected hidden; accepted/untagged visible)
 *
 * Test cases (PATCH):
 *  1. Non-openlaw slug → 404
 *  2. Missing/invalid action → 400
 *  3. Accept: publishVersion succeeds → updateNode called with status "accepted"
 *  4. Accept: publishVersion throws → updateNode NOT called, error returned
 *  5. Accept: null new_prompt_version_id → 400, no publishVersion call
 *  6. Reject → updateNode called with status "rejected"; publishVersion never called
 *  7. Fetched node with node_type !== "ProposedFix" → 404
 *  8. kgGetNode returns null → 404, no crash
 *  9. kgGetNode returns node with undefined properties → 404, no crash
 * 10. Idempotency: already "accepted" fix → no-op, no publishVersion call
 * 11. Idempotency: already "rejected" fix → no-op, no publishVersion call
 * 12. USE_MOCKS short-circuit after slug + action guards (accept)
 * 13. USE_MOCKS NOT active in production
 * 14. getWorkspaceSwarmAccess failure → error response
 * 15. getJarvisConfigForWorkspace returns null → 400
 *
 * Test cases (GET status filter):
 * 16. Rejected fix excluded from GET response
 * 17. "accepted" fix remains visible in GET response
 * 18. Fix with no status attribute (untagged) remains visible in GET response
 * 19. resolved_by and resolved_at included in GET projection
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockKgGetNode = vi.hoisted(() => vi.fn());
const mockUpdateNode = vi.hoisted(() => vi.fn());
const mockPublishVersion = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn((name: string) => `https://${name}.jarvis.example.com`),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: mockKgGetNode,
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  updateNode: mockUpdateNode,
  searchNodesByAttributes: mockSearchNodesByAttributes,
  addNode: vi.fn(),
  addEdge: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  publishVersion: mockPublishVersion,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
    },
  },
}));

// ─── Import subjects under test ───────────────────────────────────────────────

import { PATCH } from "@/app/api/workspaces/[slug]/legal/benchmarks/proposed-fixes/[refId]/route";
import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/proposed-fixes/route";
import { StakworkRunType } from "@prisma/client";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-openlaw";
const REF_ID = "fix-node-ref-1";
const PROMPT_ID = "prompt-123";
const NEW_VERSION_ID = "version-456";

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: WORKSPACE_ID,
    swarmName: "openlaw-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "decrypted-key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: "openlaw-alias",
  },
};

const MOCK_JARVIS_CONFIG = {
  jarvisUrl: "https://openlaw-swarm.jarvis.example.com",
  apiKey: "jarvis-key",
};

const MOCK_PROPOSED_FIX_NODE = {
  ref_id: REF_ID,
  node_type: "ProposedFix",
  name: "ProposedFix",
  properties: {
    criterion_id: "crit-1",
    criterion_title: "Citation Accuracy",
    prompt_id: PROMPT_ID,
    new_prompt_version_id: NEW_VERSION_ID,
    status: "pending",
    delta: "Added full citation format",
    reasoning: "Missing reporter citation",
  },
};

function makePatchRequest(slug: string, refId: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes/${refId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makePatchParams(slug: string, refId: string) {
  return { params: Promise.resolve({ slug, refId }) };
}

// ─── GET helpers for status-filter tests ─────────────────────────────────────

const RUNNER_RUN_ID = "runner-run-id-1";
const TASK_SLUG = "contracts/ndas/draft-nda";

function makeGetRequest(slug: string, runId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes?runId=${runId}`,
  );
}

function makeGetParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function makeRunnerRun() {
  return {
    id: RUNNER_RUN_ID,
    workspaceId: WORKSPACE_ID,
    type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    result: JSON.stringify({
      taskSlug: TASK_SLUG,
      score: 80,
      n_passed: 4,
      n_total: 5,
      all_pass: false,
    }),
    status: "COMPLETED",
    output: null,
    projectId: 1001,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("PATCH /api/workspaces/[slug]/legal/benchmarks/proposed-fixes/[refId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockGetJarvisConfigForWorkspace.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockKgGetNode.mockResolvedValue(MOCK_PROPOSED_FIX_NODE);
    mockUpdateNode.mockResolvedValue({ success: true });
    mockPublishVersion.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  // ── Auth / gating ─────────────────────────────────────────────────────────

  test("1. Non-openlaw slug → 404, no DB/Jarvis calls", async () => {
    const res = await PATCH(
      makePatchRequest("other-workspace", REF_ID, { action: "accept" }),
      makePatchParams("other-workspace", REF_ID),
    );
    expect(res.status).toBe(404);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockKgGetNode).not.toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  // ── Action validation ─────────────────────────────────────────────────────

  test('2a. Missing action → 400', async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, {}),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test('2b. Invalid action string → 400', async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "approve" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  // ── Accept flow ───────────────────────────────────────────────────────────

  test("3. Accept: publishVersion succeeds → updateNode called with status 'accepted'", async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("accepted");

    // publishVersion called with correct ids, undefined workspaceId (global prompts)
    expect(mockPublishVersion).toHaveBeenCalledWith(PROMPT_ID, NEW_VERSION_ID, undefined);

    // updateNode called after publish succeeds
    expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdateNode.mock.calls[0][1];
    expect(updateCall.ref_id).toBe(REF_ID);
    expect(updateCall.node_type).toBe("ProposedFix");
    expect(updateCall.node_data.status).toBe("accepted");
    expect(updateCall.node_data.resolved_by).toBe("user-1");
    expect(typeof updateCall.node_data.resolved_at).toBe("string");
  });

  test("4. Accept: publishVersion throws → updateNode NOT called, error returned", async () => {
    mockPublishVersion.mockRejectedValue(
      Object.assign(new Error("Version not found"), { status: 404 }),
    );

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    // updateNode must NOT be called — status must remain unchanged
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("5. Accept: null new_prompt_version_id → 400, no publishVersion call", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, new_prompt_version_id: null },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("5b. Accept: missing new_prompt_version_id → 400, no publishVersion call", async () => {
    const { new_prompt_version_id: _omit, ...propsWithout } = MOCK_PROPOSED_FIX_NODE.properties;
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: propsWithout,
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  // ── Reject flow ───────────────────────────────────────────────────────────

  test("6. Reject → updateNode called with status 'rejected'; publishVersion never called", async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("rejected");

    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdateNode.mock.calls[0][1];
    expect(updateCall.node_data.status).toBe("rejected");
    expect(updateCall.node_data.resolved_by).toBe("user-1");
    expect(typeof updateCall.node_data.resolved_at).toBe("string");
  });

  // ── Node fetch / validation ───────────────────────────────────────────────

  test("7. Fetched node with node_type !== 'ProposedFix' → 404", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: REF_ID,
      node_type: "EvalTrigger",
      name: "something",
      properties: { prompt_id: PROMPT_ID },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("8. kgGetNode returns null → 404, no crash", async () => {
    mockKgGetNode.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("9. kgGetNode returns node with undefined properties → 404, no crash", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: REF_ID,
      node_type: "ProposedFix",
      name: "ProposedFix",
      properties: undefined,
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  test("10. Idempotency: already 'accepted' fix → no-op, no publishVersion call", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, status: "accepted" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noOp).toBe(true);
    expect(body.status).toBe("accepted");
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("11. Idempotency: already 'rejected' fix → no-op, no publishVersion call", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, status: "rejected" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noOp).toBe(true);
    expect(body.status).toBe("rejected");
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  // ── USE_MOCKS ─────────────────────────────────────────────────────────────

  test("12. USE_MOCKS short-circuit after slug+action guards (accept)", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error — setting NODE_ENV for test
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("accepted");
    // No real calls made
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(mockKgGetNode).not.toHaveBeenCalled();

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
  });

  test("13. USE_MOCKS NOT active in production", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error
    process.env.NODE_ENV = "production";
    process.env.USE_MOCKS = "true";

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    // Real calls were made (not mocked short-circuit)
    expect(mockKgGetNode).toHaveBeenCalled();
    expect(mockUpdateNode).toHaveBeenCalled();

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
  });

  // ── Swarm/config failures ─────────────────────────────────────────────────

  test("14. getWorkspaceSwarmAccess failure → error response", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    expect(mockKgGetNode).not.toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  test("15. getJarvisConfigForWorkspace returns null → 400", async () => {
    mockGetJarvisConfigForWorkspace.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockKgGetNode).not.toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  // ── prompt_name / prompt_id identifier resolution ─────────────────────────

  test("20. Accept: prompt_name preferred when both prompt_name and prompt_id present → publishVersion called with prompt_name", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: {
        ...MOCK_PROPOSED_FIX_NODE.properties,
        prompt_name: "MY_PROMPT",
        prompt_id: PROMPT_ID,
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    // publishVersion called with prompt_name, not prompt_id
    expect(mockPublishVersion).toHaveBeenCalledWith("MY_PROMPT", NEW_VERSION_ID, undefined);
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
  });

  test("21. Accept: prompt_id-only success (no prompt_name on node)", async () => {
    // MOCK_PROPOSED_FIX_NODE already has prompt_id; ensure no prompt_name
    const { prompt_name: _omit, ...propsWithout } = {
      ...MOCK_PROPOSED_FIX_NODE.properties,
      prompt_name: undefined,
    };
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: propsWithout,
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    expect(mockPublishVersion).toHaveBeenCalledWith(PROMPT_ID, NEW_VERSION_ID, undefined);
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
  });

  test("22. Accept: missing both prompt_id and prompt_name → 400, no publishVersion call", async () => {
    const { prompt_id: _omitId, ...propsWithout } = MOCK_PROPOSED_FIX_NODE.properties;
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...propsWithout, prompt_id: null },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("23. Accept: publishVersion invoked exactly once per accept call (no double side effects)", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: {
        ...MOCK_PROPOSED_FIX_NODE.properties,
        prompt_name: "MY_PROMPT",
      },
    });

    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );

    // Exactly once — no retry, no double call
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
  });
});

// ─── GET route status filter regression tests ─────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes — status filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockGetJarvisConfigForWorkspace.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockDbStakworkRunFindFirst.mockResolvedValue(makeRunnerRun());
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  function makeNodes(nodes: Array<{ ref_id: string; status?: string | null; resolved_by?: string; resolved_at?: string }>) {
    return {
      ok: true,
      nodes: nodes.map(({ ref_id, status, resolved_by, resolved_at }) => ({
        ref_id,
        node_type: "ProposedFix",
        properties: {
          criterion_id: `crit-${ref_id}`,
          criterion_title: "Test Criterion",
          prompt_id: "prompt-abc",
          status: status ?? undefined,
          resolved_by: resolved_by ?? undefined,
          resolved_at: resolved_at ?? undefined,
        },
      })),
    };
  }

  test("16. Rejected fix excluded from GET response", async () => {
    mockSearchNodesByAttributes.mockResolvedValue(
      makeNodes([
        { ref_id: "pending-fix", status: "pending" },
        { ref_id: "rejected-fix", status: "rejected" },
      ]),
    );

    const res = await GET(makeGetRequest("openlaw", RUNNER_RUN_ID), makeGetParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.fixes.map((f: { ref_id: string }) => f.ref_id);
    expect(ids).toContain("pending-fix");
    expect(ids).not.toContain("rejected-fix");
  });

  test("17. 'accepted' fix remains visible in GET response", async () => {
    mockSearchNodesByAttributes.mockResolvedValue(
      makeNodes([
        { ref_id: "accepted-fix", status: "accepted" },
        { ref_id: "pending-fix", status: "pending" },
      ]),
    );

    const res = await GET(makeGetRequest("openlaw", RUNNER_RUN_ID), makeGetParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.fixes.map((f: { ref_id: string }) => f.ref_id);
    expect(ids).toContain("accepted-fix");
    expect(ids).toContain("pending-fix");
  });

  test("18. Fix with no status attribute (untagged/legacy) remains visible in GET response", async () => {
    mockSearchNodesByAttributes.mockResolvedValue(
      makeNodes([
        { ref_id: "untagged-fix" }, // status: undefined — legacy/untagged
        { ref_id: "rejected-fix", status: "rejected" },
      ]),
    );

    const res = await GET(makeGetRequest("openlaw", RUNNER_RUN_ID), makeGetParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.fixes.map((f: { ref_id: string }) => f.ref_id);
    expect(ids).toContain("untagged-fix");
    expect(ids).not.toContain("rejected-fix");
  });

  test("19. resolved_by and resolved_at included in GET projection", async () => {
    mockSearchNodesByAttributes.mockResolvedValue(
      makeNodes([
        {
          ref_id: "accepted-fix",
          status: "accepted",
          resolved_by: "user-99",
          resolved_at: "2026-07-15T12:00:00.000Z",
        },
      ]),
    );

    const res = await GET(makeGetRequest("openlaw", RUNNER_RUN_ID), makeGetParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);
    const fix = body.fixes[0];
    expect(fix.resolved_by).toBe("user-99");
    expect(fix.resolved_at).toBe("2026-07-15T12:00:00.000Z");
  });
});
