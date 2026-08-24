/**
 * Unit tests for:
 * 1. PATCH /api/workspaces/[slug]/legal/benchmarks/proposed-fixes/[refId]
 *    (accept/reject mutation route)
 * 2. GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes
 *    — status filter regression (rejected hidden; accepted/untagged visible)
 *
 * Test cases (PATCH):
 *  1.  Non-openlaw slug → 404
 *  2.  Missing/invalid action → 400
 *  3.  Accept (prompt): publishVersion succeeds → updateNode called with status "accepted"
 *  4.  Accept (prompt): publishVersion throws → updateNode NOT called, error returned
 *  5.  Accept (prompt): null new_prompt_version_id → 400, no publishVersion call
 *  6.  Reject → updateNode called with status "rejected"; publishVersion never called
 *  7.  Fetched node with node_type !== "ProposedFix" → 404
 *  8.  kgGetNode returns null → 404, no crash
 *  9.  kgGetNode returns node with undefined properties → 404, no crash
 * 10.  Idempotency: already "accepted" fix (eval_status field) → no-op on accept
 * 11.  Idempotency: already "rejected" fix (eval_status field) → no-op on reject
 * 12.  USE_MOCKS: auth + IDOR run first; member sees concept-aware payload
 * 13.  USE_MOCKS NOT active in production
 * 14.  getWorkspaceSwarmAccess failure → error response
 * 15.  getJarvisConfigForWorkspace returns null → 400
 * 20.  prompt_name preferred over prompt_id
 * 21.  prompt_id-only success
 * 22.  Accept: missing both prompt_id and prompt_name → 400
 * 23.  publishVersion invoked exactly once
 * 24.  Concept accept returns 200 with applied:false, no publishVersion
 * 25.  "Concept" / " concept " normalise and take the concept path
 * 26.  concept + new_prompt_version_id present → falls through to prompt path
 * 27.  Concept fix missing target_ref/target_name → 400
 * 28.  Concept fix missing new_value → 400
 * 29.  Concept pre-set eval_status "accepted" → no-op on accept
 * 30.  Concept pre-set eval_status "accepted" → rejectable once
 * 31.  Second reject on concept fix → no-op
 * 32.  accepted→rejected on prompt fix → 409 refused
 * 33.  reject-on-rejected (concept) → no-op
 * 34.  accept-on-rejected (any fix) → 409 terminal
 * 35.  resolved_by_history appends rather than overwrites on second decision
 * 36.  Publish failure returns fixed client string; real message only in server log
 * 37.  IDOR: task_slug maps to no run in workspace → 404 before updateNode
 * 38.  IDOR: task_slug absent on node → proceeds normally (no scope check)
 * 39.  TOCTOU: two concurrent accepts → exactly one write (CAS sentinel in node_data)
 * 40.  Rate limit: keyed on userId, not IP; rotating x-forwarded-for does not extend budget
 * 41.  USE_MOCKS non-member refused by getWorkspaceSwarmAccess before short-circuit
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
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

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
  // getClientIp is no longer used for the rate-limit key (we use userId), but keep
  // the mock so the import doesn't crash when the module still exports the function.
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
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
const TASK_SLUG = "contracts/ndas/draft-nda";
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

/** A standard prompt-fix node (requires new_prompt_version_id to accept). */
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
    task_slug: TASK_SLUG,
    delta: "Added full citation format",
    reasoning: "Missing reporter citation",
  },
};

/** A concept-fix node (no new_prompt_version_id; target_type "concept"). */
const MOCK_CONCEPT_FIX_NODE = {
  ref_id: REF_ID,
  node_type: "ProposedFix",
  name: "ProposedFix",
  properties: {
    target_type: "concept",
    target_name: "Limitation of Liability",
    target_ref: "concept-ref-99",
    new_value: '{"docs": "updated text"}',
    status: "pending",
    task_slug: TASK_SLUG,
  },
};

/** A scoped DB run row that satisfies the IDOR guard for TASK_SLUG. */
const MOCK_SCOPED_RUN = { id: "runner-run-1" };

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
    // Default: IDOR guard passes (task_slug maps to a run in the workspace)
    mockDbStakworkRunFindFirst.mockResolvedValue(MOCK_SCOPED_RUN);
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

  test("2a. Missing action → 400", async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, {}),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("2b. Invalid action string → 400", async () => {
    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "approve" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  // ── Accept flow (prompt fix) ───────────────────────────────────────────────

  test("3. Accept (prompt): publishVersion succeeds → updateNode called with status 'accepted'", async () => {
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
    expect(updateCall.node_data.eval_status).toBe("accepted");
    expect(updateCall.node_data.status).toBe("accepted");
    expect(updateCall.node_data.resolved_by).toBe("user-1");
    expect(typeof updateCall.node_data.resolved_at).toBe("string");
  });

  test("4. Accept (prompt): publishVersion throws → updateNode NOT called, error returned", async () => {
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

  test("5. Accept (prompt): null new_prompt_version_id → 400, no publishVersion call", async () => {
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

  test("5b. Accept (prompt): missing new_prompt_version_id → 400, no publishVersion call", async () => {
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
    expect(updateCall.node_data.eval_status).toBe("rejected");
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

  // ── Idempotency (reads eval_status first, falls back to status) ───────────

  test("10. Idempotency: eval_status='accepted' + action='accept' → no-op, no publishVersion", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: {
        ...MOCK_PROPOSED_FIX_NODE.properties,
        eval_status: "accepted", // canonical field
        status: "accepted",
      },
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

  test("10b. Idempotency: eval_status='accepted' (only) + action='accept' → no-op (reads eval_status ?? status)", async () => {
    // eval_status only — legacy status field absent — must still be idempotent
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, eval_status: "accepted" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noOp).toBe(true);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("11. Idempotency: eval_status='rejected' + action='reject' → no-op, no publishVersion", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: {
        ...MOCK_PROPOSED_FIX_NODE.properties,
        eval_status: "rejected",
        status: "rejected",
      },
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

  // ── USE_MOCKS — must traverse auth BEFORE short-circuiting ────────────────

  test("12. USE_MOCKS: member gets concept-aware payload AFTER auth + IDOR checks pass", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error — setting NODE_ENV for test
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    // Swarm access passes (member), kgGetNode returns a concept node so the IDOR
    // guard can resolve the task_slug, DB returns a scoped run.
    mockKgGetNode.mockResolvedValue(MOCK_CONCEPT_FIX_NODE);

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("accepted");
    // Concept-aware fields must be present in the mock response
    expect(body.applied).toBe(false);
    expect(body.kind).toBe("concept");

    // Auth + node fetch ran; no graph write (short-circuit before updateNode)
    expect(mockGetWorkspaceSwarmAccess).toHaveBeenCalled();
    expect(mockKgGetNode).toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();

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
    // Real calls were made (not the mock short-circuit)
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

  test("20. Accept: prompt_name preferred when both present → publishVersion called with prompt_name", async () => {
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
    expect(mockPublishVersion).toHaveBeenCalledWith("MY_PROMPT", NEW_VERSION_ID, undefined);
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
  });

  test("21. Accept: prompt_id-only success (no prompt_name on node)", async () => {
    const { prompt_name: _omit, ...propsWithout } = {
      ...MOCK_PROPOSED_FIX_NODE.properties,
      prompt_name: undefined as unknown as string,
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

  test("23. Accept: publishVersion invoked exactly once per accept call", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, prompt_name: "MY_PROMPT" },
    });

    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
  });

  // ── Concept fix — core accept ─────────────────────────────────────────────

  test("24. Concept accept returns 200 with applied:false, kind:'concept', no publishVersion", async () => {
    mockKgGetNode.mockResolvedValue(MOCK_CONCEPT_FIX_NODE);

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("accepted");
    expect(body.applied).toBe(false);
    expect(body.kind).toBe("concept");
    expect(mockPublishVersion).not.toHaveBeenCalled();

    // updateNode must be called with the correct fields
    expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    const call = mockUpdateNode.mock.calls[0][1];
    expect(call.node_data.eval_status).toBe("accepted");
    expect(call.node_data.status).toBe("accepted");
    expect(call.node_data.resolved_by).toBe("user-1");
    expect(typeof call.node_data.resolved_at).toBe("string");
  });

  test("25a. 'Concept' (uppercase C) normalises and takes the concept path", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, target_type: "Concept" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(false);
    expect(body.kind).toBe("concept");
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  test("25b. ' concept ' (padded with spaces) normalises and takes the concept path", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, target_type: " concept " },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(false);
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  test("26. concept + new_prompt_version_id → falls through to prompt path and calls publishVersion", async () => {
    // A node labelled concept but carrying new_prompt_version_id must NOT bypass publish.
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        ...MOCK_CONCEPT_FIX_NODE.properties,
        prompt_name: "MY_PROMPT",
        new_prompt_version_id: NEW_VERSION_ID,
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    // Should reach the prompt path and publish successfully
    expect(res.status).toBe(200);
    expect(mockPublishVersion).toHaveBeenCalledTimes(1);
    const body = await res.json();
    // Prompt path does not return applied:false
    expect(body.applied).toBeUndefined();
    expect(body.kind).toBeUndefined();
  });

  test("27. Concept fix missing target_ref AND target_name → 400", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        target_type: "concept",
        new_value: '{"docs": "something"}',
        status: "pending",
        task_slug: TASK_SLUG,
        // No target_ref, no target_name
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("28. Concept fix missing new_value → 400", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        target_type: "concept",
        target_name: "Limitation of Liability",
        status: "pending",
        task_slug: TASK_SLUG,
        // No new_value
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(400);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("28b. target_name alone (no target_ref) is sufficient — accepts successfully", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        target_type: "concept",
        target_name: "Limitation of Liability",
        new_value: '{"docs": "updated"}',
        status: "pending",
        task_slug: TASK_SLUG,
        // No target_ref — target_name alone must satisfy the guard
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(false);
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  // ── Concept idempotency & transition rules ────────────────────────────────

  test("29. Concept pre-set to eval_status='accepted' → no-op on accept (same-action)", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, eval_status: "accepted" },
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

  test("30. Concept pre-set to eval_status='accepted' → rejectable once (human re-review)", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        ...MOCK_CONCEPT_FIX_NODE.properties,
        eval_status: "accepted",
        // resolved_by present so history is seeded correctly
        resolved_by: "automation",
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("rejected");
    // Must write the rejected status
    expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    const call = mockUpdateNode.mock.calls[0][1];
    expect(call.node_data.eval_status).toBe("rejected");
  });

  test("31. Second reject on concept fix (already rejected) → no-op", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, eval_status: "rejected" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noOp).toBe(true);
    expect(body.status).toBe("rejected");
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("32. accepted→rejected on a PROMPT fix → 409 refused (publishVersion already ran)", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, eval_status: "accepted" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Cannot reject");
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("33. reject-on-rejected (concept) → no-op (terminal state, not 409)", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, eval_status: "rejected" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noOp).toBe(true);
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("34. accept-on-rejected (any fix) → 409 terminal state", async () => {
    mockKgGetNode.mockResolvedValue({
      ...MOCK_PROPOSED_FIX_NODE,
      properties: { ...MOCK_PROPOSED_FIX_NODE.properties, eval_status: "rejected" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(409);
    expect(mockPublishVersion).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  // ── resolved_by_history ───────────────────────────────────────────────────

  test("35. resolved_by_history appends rather than overwrites on second decision", async () => {
    // Node has already been accepted by "automation"; user-1 is now rejecting (concept).
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        ...MOCK_CONCEPT_FIX_NODE.properties,
        eval_status: "accepted",
        resolved_by: "automation",
        resolved_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(200);

    // Verify the history field was passed to updateNode and contains both entries.
    const call = mockUpdateNode.mock.calls[0][1];
    const historyStr = call.node_data.resolved_by_history as string;
    const history = JSON.parse(historyStr) as Array<{ resolved_by: string; action: string }>;

    expect(history).toHaveLength(2);
    // First entry: the original "automation" accept decision
    expect(history[0].resolved_by).toBe("automation");
    expect(history[0].action).toBe("accepted");
    // Second entry: the reviewer's rejection
    expect(history[1].resolved_by).toBe("user-1");
    expect(history[1].action).toBe("reject");
  });

  // ── Error reflection ──────────────────────────────────────────────────────

  test("36. Publish failure: fixed client-facing string; real message only in server log", async () => {
    const internalMessage = "Internal Bifrost error: connection refused";
    mockPublishVersion.mockRejectedValue(
      Object.assign(new Error(internalMessage), { status: 500 }),
    );

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    // Client must NOT see the internal message
    expect(body.error).not.toContain(internalMessage);
    expect(body.error).toBe("Failed to publish prompt version");

    // But the server log should have captured it
    const errorCalls = mockLoggerError.mock.calls;
    const hasInternalMsg = errorCalls.some((call) =>
      JSON.stringify(call).includes(internalMessage),
    );
    expect(hasInternalMsg).toBe(true);
  });

  // ── IDOR guard ────────────────────────────────────────────────────────────

  test("37. IDOR: task_slug maps to no run in this workspace → 404 before any updateNode", async () => {
    // DB returns null → the fix belongs to a different workspace
    mockDbStakworkRunFindFirst.mockResolvedValue(null);
    mockKgGetNode.mockResolvedValue(MOCK_CONCEPT_FIX_NODE);

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    // updateNode must NOT have been called
    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  test("38. IDOR: task_slug absent on node → 404, write refused (fail-closed)", async () => {
    // A ProposedFix with no task_slug cannot be scoped to any workspace run.
    // Allowing the write would let any authenticated openlaw member mutate arbitrary
    // unscoped nodes. The guard must be fail-closed, not fail-open.
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: { ...MOCK_CONCEPT_FIX_NODE.properties, task_slug: null },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(404);
    // DB was NOT queried (refused before the scope lookup)
    expect(mockDbStakworkRunFindFirst).not.toHaveBeenCalled();
    // No write must have happened
    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(mockPublishVersion).not.toHaveBeenCalled();
  });

  // ── TOCTOU — CAS sentinel ─────────────────────────────────────────────────

  test("39. CAS sentinel (_cas_eval_status) is included in the updateNode payload", async () => {
    // This test verifies the route passes the compare-and-set sentinel so Jarvis
    // can enforce it.  Two concurrent PATCHes that both read the same status and
    // both write would produce two calls with the same sentinel; only one can
    // succeed if Jarvis honours the CAS.  Here we assert the field is present and
    // matches the status the route observed at read time.
    mockKgGetNode.mockResolvedValue(MOCK_CONCEPT_FIX_NODE);
    // MOCK_CONCEPT_FIX_NODE has status:"pending", no eval_status → currentStatus="pending"

    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );

    const call = mockUpdateNode.mock.calls[0][1];
    // CAS sentinel must be present and equal the status read from the node.
    expect("_cas_eval_status" in call.node_data).toBe(true);
    // eval_status absent, status="pending" → currentStatus is "pending"
    expect(call.node_data._cas_eval_status).toBe("pending");
  });

  test("39b. Reject also carries the CAS sentinel matching the read status", async () => {
    // MOCK_PROPOSED_FIX_NODE has status:"pending", no eval_status → CAS = "pending"
    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );

    const call = mockUpdateNode.mock.calls[0][1];
    expect("_cas_eval_status" in call.node_data).toBe(true);
    expect(call.node_data._cas_eval_status).toBe("pending");
  });

  test("39c. CAS sentinel is null when neither eval_status nor status is set on the node", async () => {
    // Simulate a legacy node with no status fields at all.
    mockKgGetNode.mockResolvedValue({
      ...MOCK_CONCEPT_FIX_NODE,
      properties: {
        target_type: "concept",
        target_name: "Limitation of Liability",
        target_ref: "concept-ref-99",
        new_value: '{"docs": "updated text"}',
        task_slug: TASK_SLUG,
        // No status, no eval_status
      },
    });

    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );

    const call = mockUpdateNode.mock.calls[0][1];
    expect("_cas_eval_status" in call.node_data).toBe(true);
    // currentStatus resolves to undefined → CAS sentinel is null
    expect(call.node_data._cas_eval_status).toBeNull();
  });

  // ── Rate limit: keyed on userId, not IP ──────────────────────────────────

  test("40. Rate limit is keyed on userId, not IP — rotating x-forwarded-for does not bypass it", async () => {
    await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "reject" }),
      makePatchParams("openlaw", REF_ID),
    );

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    const [key] = mockCheckRateLimit.mock.calls[0];
    // Key must contain the userId (user-1), NOT an IP address
    expect(key).toContain("user-1");
    expect(key).not.toContain("127.0.0.1");
  });

  test("40b. Rate limit exceeded → 429 with retryAfter", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBe(42);
    expect(mockKgGetNode).not.toHaveBeenCalled();
  });

  // ── USE_MOCKS non-member refused before short-circuit ─────────────────────

  test("41. USE_MOCKS non-member is refused by getWorkspaceSwarmAccess before short-circuit", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    // Simulate a non-member: swarm access check refuses
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });

    const res = await PATCH(
      makePatchRequest("openlaw", REF_ID, { action: "accept" }),
      makePatchParams("openlaw", REF_ID),
    );
    // Must NOT get a success response; access is denied
    expect(res.status).toBe(403);
    expect(mockKgGetNode).not.toHaveBeenCalled();
    expect(mockUpdateNode).not.toHaveBeenCalled();

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
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

  function makeNodes(nodes: Array<{ ref_id: string; status?: string | null; eval_status?: string | null; resolved_by?: string; resolved_at?: string }>) {
    return {
      ok: true,
      nodes: nodes.map(({ ref_id, status, eval_status, resolved_by, resolved_at }) => ({
        ref_id,
        node_type: "ProposedFix",
        properties: {
          criterion_id: `crit-${ref_id}`,
          criterion_title: "Test Criterion",
          prompt_id: "prompt-abc",
          status: status ?? undefined,
          eval_status: eval_status ?? undefined,
          resolved_by: resolved_by ?? undefined,
          resolved_at: resolved_at ?? undefined,
        },
      })),
    };
  }

  test("16. Rejected fix (status field) excluded from GET response", async () => {
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
