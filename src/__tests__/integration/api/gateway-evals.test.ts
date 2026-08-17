/**
 * Integration tests for /api/gateway/evals/** proxy routes.
 *
 * Covers:
 * - Auth: valid key resolves correct workspace
 * - Auth: missing / malformed / revoked / expired key → 401
 * - IDOR guard: workspace-A key cannot reach workspace-B swarm
 * - POST /api/gateway/evals → returns ref_id; duplicate → 409
 * - PUT/DELETE /api/gateway/evals/:setId → 204
 * - POST /api/gateway/evals/:setId/requirements → returns ref_id
 * - PUT/DELETE /api/gateway/evals/:setId/requirements/:reqId → 204
 * - POST .../run → returns project_ids for all triggers; zero triggers → 404
 * - Run route passes apiKey.createdById as userId to dispatchEvalTriggerRun
 *   → getBifrostForLLM is called with that userId
 * - `contested`: create default / loose coercion / un-coercible → 400 /
 *   omission preserves the stored value / transition logging
 * - Ownership: unresolvable eval set or cross-eval-set reqId → 404, no write
 * - Rate limit: past the per-key limit → 429
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";
import { generateUniqueId, generateUniqueSlug, generateUniqueEmail } from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/factories";

import { POST as postEvalSet } from "@/app/api/gateway/evals/route";
import { PUT as putEvalSet, DELETE as deleteEvalSet } from "@/app/api/gateway/evals/[setId]/route";
import { POST as postRequirement } from "@/app/api/gateway/evals/[setId]/requirements/route";
import {
  PUT as putRequirement,
  DELETE as deleteRequirement,
} from "@/app/api/gateway/evals/[setId]/requirements/[reqId]/route";
import { POST as runEvals } from "@/app/api/gateway/evals/[setId]/requirements/[reqId]/run/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(),
  BIFROST_AGENT_NAMES: ["repo-agent", "canvas-agent"],
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  },
}));

import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { redis } from "@/lib/redis";

// ── Constants ─────────────────────────────────────────────────────────────────

const RAW_KEY_1 = "hive_test_gateway-evals-key-workspace-one-1234567890ab";
const RAW_KEY_2 = "hive_test_gateway-evals-key-workspace-two-1234567890ab";
const SET_ID = "evalset-gw-ref-001";
const REQ_ID = "evalreq-gw-ref-002";
const TRIGGER_ID = "evaltrig-gw-ref-003";
const SWARM_NAME_1 = "test-gw-evals-swarm-1";
const SWARM_NAME_2 = "test-gw-evals-swarm-2";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  url: string,
  key?: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeApiKeyRequest(
  method: string,
  url: string,
  key?: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["x-api-key"] = key;
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Queue the ownership fetch every requirement write now performs: the eval set
 * resolved inside the caller's own swarm, with its HAS_REQUIREMENT children.
 * Mirrors Jarvis's real casing ("Evalset" / "Evalrequirement").
 */
function mockEvalSetScope(
  setId: string,
  requirements: Array<{ ref_id: string; properties?: Record<string, unknown> }> = [],
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      nodes: [
        { ref_id: setId, node_type: "Evalset", properties: { name: "The set" } },
        ...requirements.map((r) => ({
          ref_id: r.ref_id,
          node_type: "Evalrequirement",
          properties: r.properties ?? {},
        })),
      ],
      edges: [],
    }),
  } as Response);
}

/** Queue an ownership fetch that resolves nothing — an id outside this swarm. */
function mockEvalSetNotFound() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ nodes: [], edges: [] }),
  } as Response);
}

/** node_data sent to Jarvis by addNode (POST /v2/nodes). */
function capturedAddNodeData(): Record<string, unknown> | null {
  const call = mockFetch.mock.calls.find(
    (c) => c[1]?.method === "POST" && String(c[0]).endsWith("/v2/nodes"),
  );
  if (!call) return null;
  return JSON.parse(call[1].body as string)?.node_data ?? null;
}

/** node_data sent to Jarvis by updateNode (PUT /node?ref_id=...). */
function capturedUpdateNodeData(): Record<string, unknown> | null {
  const call = mockFetch.mock.calls.find((c) => String(c[0]).includes("/node?ref_id="));
  if (!call) return null;
  return JSON.parse(call[1].body as string)?.node_data ?? null;
}

function jarvisWriteCalls() {
  return mockFetch.mock.calls.filter(
    (c) =>
      (c[1]?.method === "POST" && String(c[0]).endsWith("/v2/nodes")) ||
      String(c[0]).includes("/node?ref_id=") ||
      String(c[0]).includes("/node/edge"),
  );
}

async function capturedStakworkVars(): Promise<Record<string, unknown> | null> {
  const stakworkCall = mockFetch.mock.calls.find((call) =>
    String(call[0]).includes("/projects"),
  );
  if (!stakworkCall) return null;
  const body = JSON.parse(stakworkCall[1].body as string);
  return body?.workflow_params?.set_var?.attributes?.vars ?? null;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

interface TestContext {
  user: { id: string; email: string | null };
  workspace: { id: string; slug: string };
  apiKey: { id: string };
}

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdApiKeyIds: string[] = [];

async function createTestContext(rawKey: string, swarmName: string): Promise<TestContext> {
  const user = await createTestUser({
    email: generateUniqueEmail("gw-user"),
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    slug: generateUniqueSlug("gw-ws"),
    name: "Gateway Evals Test Workspace",
    ownerId: user.id,
  });
  createdWorkspaceIds.push(workspace.id);

  await createTestSwarm({
    workspaceId: workspace.id,
    swarmApiKey: "test-swarm-key",
    name: swarmName,
    swarmUrl: `https://${swarmName}.sphinx.chat/api`,
  });

  const apiKey = await db.workspaceApiKey.create({
    data: {
      workspaceId: workspace.id,
      name: "gateway-evals",
      keyPrefix: rawKey.slice(0, 8),
      keyHash: hashApiKey(rawKey),
      createdById: user.id,
    },
  });
  createdApiKeyIds.push(apiKey.id);

  return { user, workspace, apiKey };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;

  process.env.STAKWORK_EVAL_WORKFLOW_ID = "42";
  process.env.STAKWORK_API_KEY = "test-stakwork-api-key";
  process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";

  vi.mocked(getBifrostForLLM).mockResolvedValue(undefined);

  // Under the limit by default; individual tests push the counter over.
  vi.mocked(redis.incr).mockResolvedValue(1);
  vi.mocked(redis.expire).mockResolvedValue(1);
  vi.mocked(redis.ttl).mockResolvedValue(60);
});

afterEach(async () => {
  if (createdApiKeyIds.length > 0) {
    await db.workspaceApiKey.deleteMany({ where: { id: { in: createdApiKeyIds } } });
    createdApiKeyIds.length = 0;
  }
  if (createdWorkspaceIds.length > 0) {
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ── Auth tests ────────────────────────────────────────────────────────────────

describe("POST /api/gateway/evals — auth", () => {
  test("returns 401 when no key is provided", async () => {
    const req = makeRequest("POST", "http://localhost/api/gateway/evals", undefined, { name: "My Set" });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(401);
  });

  test("returns 401 for a malformed key", async () => {
    const req = makeRequest("POST", "http://localhost/api/gateway/evals", "not-a-valid-key", { name: "My Set" });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(401);
  });

  test("returns 401 for an unknown key", async () => {
    const req = makeRequest("POST", "http://localhost/api/gateway/evals", "hive_xxxx_unknownkey999", { name: "My Set" });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(401);
  });

  test("returns 401 for a revoked key", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-rev");
    await db.workspaceApiKey.update({
      where: { id: ctx.apiKey.id },
      data: { revokedAt: new Date() },
    });

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, { name: "My Set" });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(401);
  });

  test("returns 401 for an expired key", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-exp");
    await db.workspaceApiKey.update({
      where: { id: ctx.apiKey.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, { name: "My Set" });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(401);
  });

  test("accepts key via x-api-key header", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-hdr");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { ref_id: "new-set-ref" } }),
    } as Response);

    const req = makeApiKeyRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, { name: "My Set" });
    const res = await postEvalSet(req as any);
    // Should proceed past auth (200 or 201 or even 502 if Jarvis mock differs — not 401)
    expect(res.status).not.toBe(401);
    void ctx; // used above
  });
});

// ── IDOR guard ────────────────────────────────────────────────────────────────

describe("IDOR guard", () => {
  test("workspace-A key cannot affect workspace-B swarm", async () => {
    const ctxA = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-idor-a");
    const ctxB = await createTestContext(RAW_KEY_2, SWARM_NAME_2 + "-idor-b");

    // Use workspace-A key for a request; Jarvis should be called with workspace-A's swarm
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { ref_id: "set-a-ref" } }),
    } as Response);

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, {
      name: "Set from A",
    });
    const res = await postEvalSet(req as any);
    // Regardless of Jarvis result, the Jarvis URL called must include swarm-A's name
    const jarvisCall = mockFetch.mock.calls[0];
    if (jarvisCall) {
      const calledUrl = String(jarvisCall[0]);
      expect(calledUrl).toContain(SWARM_NAME_1 + "-idor-a");
      expect(calledUrl).not.toContain(SWARM_NAME_2 + "-idor-b");
    }
    expect(res.status).not.toBe(401);
    void ctxB;
  });
});

// ── POST /api/gateway/evals ───────────────────────────────────────────────────

describe("POST /api/gateway/evals", () => {
  test("returns ref_id on successful create", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-post");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: { ref_id: "new-evalset-ref" } }),
    } as Response);

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, {
      name: "My Eval Set",
      description: "Test description",
    });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ref_id).toBe("new-evalset-ref");
    void ctx;
  });

  test("returns 409 when the EvalSet already exists (alreadyExists flag)", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-dup");

    // Jarvis returns status_messages with "already exists" (alreadyExists path in addNode)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "Warning",
        status_messages: ["Node already exists"],
        data: { ref_id: "existing-evalset-ref" },
      }),
    } as Response);

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, {
      name: "Duplicate Set",
    });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(409);
    void ctx;
  });

  test("returns 400 if name is missing", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-noname");

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, {
      description: "no name here",
    });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
    void ctx;
  });

  test("returns 502 if Jarvis call fails", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-502");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response);

    const req = makeRequest("POST", "http://localhost/api/gateway/evals", RAW_KEY_1, {
      name: "Set",
    });
    const res = await postEvalSet(req as any);
    expect(res.status).toBe(502);
    void ctx;
  });
});

// ── PUT /api/gateway/evals/:setId ─────────────────────────────────────────────

describe("PUT /api/gateway/evals/:setId", () => {
  test("returns 204 on successful update", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-put");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest("PUT", `http://localhost/api/gateway/evals/${SET_ID}`, RAW_KEY_1, {
      name: "Updated Name",
    });
    const res = await putEvalSet(req as any, { params: Promise.resolve({ setId: SET_ID }) });
    expect(res.status).toBe(204);
    void ctx;
  });

  test("returns 401 for missing key", async () => {
    const req = makeRequest("PUT", `http://localhost/api/gateway/evals/${SET_ID}`, undefined, {
      name: "Updated Name",
    });
    const res = await putEvalSet(req as any, { params: Promise.resolve({ setId: SET_ID }) });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/gateway/evals/:setId ─────────────────────────────────────────

describe("DELETE /api/gateway/evals/:setId", () => {
  test("returns 204 on successful delete", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-del");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest("DELETE", `http://localhost/api/gateway/evals/${SET_ID}`, RAW_KEY_1);
    const res = await deleteEvalSet(req as any, { params: Promise.resolve({ setId: SET_ID }) });
    expect(res.status).toBe(204);
    void ctx;
  });

  test("returns 401 for missing key", async () => {
    const req = makeRequest("DELETE", `http://localhost/api/gateway/evals/${SET_ID}`);
    const res = await deleteEvalSet(req as any, { params: Promise.resolve({ setId: SET_ID }) });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/gateway/evals/:setId/requirements ───────────────────────────────

describe("POST /api/gateway/evals/:setId/requirements", () => {
  test("returns ref_id on successful create", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-req-post");

    // First fetch: ownership resolution, which also supplies the sibling count
    mockEvalSetScope(SET_ID);
    // Second fetch: addNode
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success", data: { ref_id: "new-req-ref" } }),
    } as Response);
    // Third fetch: addEdge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success", edges: [{}] }),
    } as Response);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { name: "My Requirement", description: "Test reason" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ref_id).toBe("new-req-ref");
    void ctx;
  });

  test("returns 400 if name is missing", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-req-noname");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { description: "no name" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });
    expect(res.status).toBe(400);
    void ctx;
  });

  test("returns 401 for missing key", async () => {
    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      undefined,
      { name: "Req" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });
    expect(res.status).toBe(401);
  });
});

// ── PUT/DELETE /api/gateway/evals/:setId/requirements/:reqId ─────────────────

describe("PUT /api/gateway/evals/:setId/requirements/:reqId", () => {
  test("returns 204 on successful update", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-req-put");

    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Updated Requirement" },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(204);
    void ctx;
  });

  test("returns 401 for missing key", async () => {
    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      undefined,
      { name: "Updated" },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/gateway/evals/:setId/requirements/:reqId", () => {
  test("returns 204 on successful delete", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-req-del");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest(
      "DELETE",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
    );
    const res = await deleteRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(204);
    void ctx;
  });

  test("returns 401 for missing key", async () => {
    const req = makeRequest(
      "DELETE",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
    );
    const res = await deleteRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(401);
  });
});

// ── contested field ───────────────────────────────────────────────────────────

describe("contested — POST /api/gateway/evals/:setId/requirements", () => {
  function mockCreateSuccess() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success", data: { ref_id: "new-req-ref" } }),
    } as Response); // addNode
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success", edges: [{}] }),
    } as Response); // addEdge
  }

  async function post(body: unknown) {
    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      body,
    );
    return postRequirement(req as any, { params: Promise.resolve({ setId: SET_ID }) });
  }

  test("persists false when contested is omitted", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-post-omit");
    mockEvalSetScope(SET_ID);
    mockCreateSuccess();

    const res = await post({ name: "Req" });
    expect(res.status).toBe(201);
    expect(capturedAddNodeData()?.contested).toBe(false);
  });

  test("persists true when contested is true", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-post-true");
    mockEvalSetScope(SET_ID);
    mockCreateSuccess();

    const res = await post({ name: "Req", contested: true });
    expect(res.status).toBe(201);
    expect(capturedAddNodeData()?.contested).toBe(true);
  });

  test('coerces "true" to a real boolean', async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-post-str");
    mockEvalSetScope(SET_ID);
    mockCreateSuccess();

    const res = await post({ name: "Req", contested: "TRUE" });
    expect(res.status).toBe(201);
    expect(capturedAddNodeData()?.contested).toBe(true);
  });

  test("400s with a field-specific message on an un-coercible value, before any write", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-post-bad");

    const res = await post({ name: "Req", contested: "maybe" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/contested/i);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });
});

describe("contested — PUT /api/gateway/evals/:setId/requirements/:reqId", () => {
  function mockUpdateSuccess() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);
  }

  async function put(body: unknown) {
    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      body,
    );
    return putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
  }

  test("omitting contested leaves the key out of the update payload entirely", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-put-omit");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID, properties: { contested: true } }]);
    mockUpdateSuccess();

    const res = await put({ name: "Renamed only" });
    expect(res.status).toBe(204);

    // updateNode is a partial merge — absence preserves the stored `true`.
    // A literal `false` here would silently un-contest the requirement.
    const nodeData = capturedUpdateNodeData();
    expect(nodeData).not.toHaveProperty("contested");
  });

  test("coerces a string flag to a real boolean", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-put-str");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID }]);
    mockUpdateSuccess();

    const res = await put({ name: "Req", contested: "true" });
    expect(res.status).toBe(204);
    expect(capturedUpdateNodeData()?.contested).toBe(true);
  });

  test("writes an explicit false when contested is turned off", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-put-false");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID, properties: { contested: true } }]);
    mockUpdateSuccess();

    const res = await put({ name: "Req", contested: false });
    expect(res.status).toBe(204);
    expect(capturedUpdateNodeData()?.contested).toBe(false);
  });

  test("an un-coercible value 400s and leaves the requirement untouched", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-put-bad");

    const res = await put({ name: "Req", contested: "maybe" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/contested/i);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });

  test("logs the transition with explicit scalars and no secrets", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-c-put-log");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID, properties: { contested: false } }]);
    mockUpdateSuccess();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await put({ name: "Req", contested: true });
      expect(res.status).toBe(204);

      const transition = logSpy.mock.calls
        .map((c) => c.join(" "))
        .find((line) => line.includes("contested transition"));
      expect(transition).toBeDefined();
      expect(transition).toContain(`setId=${SET_ID}`);
      expect(transition).toContain(`reqId=${REQ_ID}`);
      expect(transition).toContain(`keyId=${ctx.apiKey.id}`);
      expect(transition).toContain("contestedBefore=false");
      expect(transition).toContain("contestedAfter=true");
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ── Ownership (IDOR) ──────────────────────────────────────────────────────────

describe("ownership validation", () => {
  test("POST 404s when the eval set does not resolve in the caller's swarm", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-post");
    mockEvalSetNotFound();

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { name: "Req", contested: true },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });

    expect(res.status).toBe(404);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });

  test("POST 404s when the ref_id resolves to a node that is not an EvalSet", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-wrongtype");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        nodes: [{ ref_id: SET_ID, node_type: "Task", properties: {} }],
        edges: [],
      }),
    } as Response);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { name: "Req" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });

    expect(res.status).toBe(404);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });

  test("PUT 404s for a reqId that belongs to a different eval set", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-cross");
    mockEvalSetScope(SET_ID, [{ ref_id: "some-other-requirement" }]);

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Req", contested: true },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });

    expect(res.status).toBe(404);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });

  test("PUT 404s when the eval set itself does not resolve", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-put-set");
    mockEvalSetNotFound();

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Req" },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });

    expect(res.status).toBe(404);
    expect(jarvisWriteCalls()).toHaveLength(0);
  });

  test("the ownership fetch targets the caller's own swarm and encodes setId", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-url");
    mockEvalSetNotFound();

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { name: "Req" },
    );
    await postRequirement(req as any, { params: Promise.resolve({ setId: SET_ID }) });

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain(SWARM_NAME_1 + "-own-url");
    expect(calledUrl).toContain(`/v2/nodes/${SET_ID}`);
    expect(calledUrl).toContain(encodeURIComponent("['HAS_REQUIREMENT']"));
  });

  test("a setId that is not a valid ref_id is rejected before any fetch", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-own-badid");

    const badSetId = "../../v2/nodes";
    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${badSetId}/requirements`,
      RAW_KEY_1,
      { name: "Req" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: badSetId }),
    });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe("rate limiting", () => {
  test("POST 429s past the limit, before any write", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-rl-post");
    vi.mocked(redis.incr).mockResolvedValue(9999);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements`,
      RAW_KEY_1,
      { name: "Req" },
    );
    const res = await postRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID }),
    });

    expect(res.status).toBe(429);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("PUT 429s past the limit, before any write", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-rl-put");
    vi.mocked(redis.incr).mockResolvedValue(9999);

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Req", contested: true },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });

    expect(res.status).toBe(429);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("the limiter is keyed on the API key id, not the client IP", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-rl-key");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Req" },
    );
    await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });

    expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining(ctx.apiKey.id));
  });

  test("a limiter outage fails open rather than blocking the write", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-rl-down");
    vi.mocked(redis.incr).mockRejectedValue(new Error("ECONNREFUSED"));
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const req = makeRequest(
      "PUT",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
      RAW_KEY_1,
      { name: "Req", contested: true },
    );
    const res = await putRequirement(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });

    expect(res.status).toBe(204);
  });
});

// ── Secret hygiene ────────────────────────────────────────────────────────────

describe("logging", () => {
  test("no log line carries the API key or the decrypted swarm key", async () => {
    await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-log-secrets");
    mockEvalSetScope(SET_ID, [{ ref_id: REQ_ID, properties: { contested: false } }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    } as Response);

    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );

    try {
      const req = makeRequest(
        "PUT",
        `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}`,
        RAW_KEY_1,
        { name: "Req", contested: true },
      );
      const res = await putRequirement(req as any, {
        params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
      });
      expect(res.status).toBe(204);

      const emitted = spies
        .flatMap((spy) => spy.mock.calls)
        .map((call) => call.map((arg) => JSON.stringify(arg) ?? String(arg)).join(" "))
        .join("\n");

      expect(emitted).not.toContain("test-swarm-key");
      expect(emitted).not.toContain(RAW_KEY_1);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

// ── POST .../run ──────────────────────────────────────────────────────────────

describe("POST /api/gateway/evals/:setId/requirements/:reqId/run", () => {
  function mockTriggersResponse(
    triggers: Array<{ ref_id: string; source?: string; agent?: string }>,
  ) {
    const nodes = [
      ...triggers.map((t) => ({
        ref_id: t.ref_id,
        node_type: "EvalTrigger",
        properties: { source: t.source ?? "repo_agent", ...(t.agent ? { agent: t.agent } : {}) },
      })),
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes, edges: [] }),
    } as Response);
  }

  function mockStakworkSuccess(projectId = "stakwork-project-42") {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ project_id: projectId }),
    } as Response);
  }

  function mockJarvisNodeFetch(source = "repo_agent") {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ properties: { source } }),
    } as Response);
  }

  test("returns 401 for missing key", async () => {
    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when requirement has no triggers", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-notrig");

    // Jarvis returns no trigger nodes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    } as Response);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/trigger/i);
    void ctx;
  });

  test("returns project_ids for a single trigger", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-single");

    mockTriggersResponse([{ ref_id: TRIGGER_ID, source: "repo_agent" }]);
    mockStakworkSuccess("proj-111");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project_ids).toEqual(["proj-111"]);
    void ctx;
  });

  test("returns all project_ids for multiple triggers", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-multi");

    mockTriggersResponse([
      { ref_id: "trigger-a", source: "repo_agent" },
      { ref_id: "trigger-b", source: "jamie_agent" },
    ]);
    mockStakworkSuccess("proj-aaa");
    mockStakworkSuccess("proj-bbb");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project_ids).toHaveLength(2);
    expect(body.project_ids).toContain("proj-aaa");
    expect(body.project_ids).toContain("proj-bbb");
    void ctx;
  });

  test("passes apiKey.createdById as userId to dispatchEvalTriggerRun", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-bifrost");

    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-key-abc",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: { "x-macaroon": "test-mac" },
      runId: "run-xyz",
      agentName: "repo-agent",
    });

    mockTriggersResponse([{ ref_id: TRIGGER_ID, source: "repo_agent" }]);
    mockStakworkSuccess("proj-bifrost-99");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);

    // getBifrostForLLM must have been called with the key creator's userId
    expect(getBifrostForLLM).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ctx.user.id }),
      expect.anything(),
    );

    // Bifrost vars must appear in the Stakwork payload
    const vars = await capturedStakworkVars();
    expect(vars?.bifrostApiKey).toBe("vk-key-abc");
  });

  test("resolves Bifrost identity from the trigger's stored agent", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-trig-agent");

    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-key-build",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: { "x-macaroon": "test-mac" },
      runId: "run-build",
      agentName: "build-agent",
    });

    mockTriggersResponse([
      { ref_id: TRIGGER_ID, source: "repo_agent", agent: "build-agent" },
    ]);
    mockStakworkSuccess("proj-build-1");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);

    // Identity must be the trigger's agent, not the source-mapped default.
    expect(getBifrostForLLM).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentName: "build-agent" }),
    );
    void ctx;
  });

  test("falls back to the source-mapped agent when the trigger's agent yields no creds", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-fallback");

    // First call (build-agent) → undefined (e.g. partial
    // BIFROST_ENABLED_AGENTS rollout); second call (repo-agent) → creds.
    vi.mocked(getBifrostForLLM)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        apiKey: "vk-key-repo",
        baseUrl: "https://bifrost.example.com/anthropic/v1",
        headers: { "x-macaroon": "test-mac" },
        runId: "run-repo",
        agentName: "repo-agent",
      });

    mockTriggersResponse([
      { ref_id: TRIGGER_ID, source: "repo_agent", agent: "build-agent" },
    ]);
    mockStakworkSuccess("proj-fallback-1");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);

    expect(getBifrostForLLM).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ agentName: "build-agent" }),
    );
    expect(getBifrostForLLM).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ agentName: "repo-agent" }),
    );

    const vars = await capturedStakworkVars();
    expect(vars?.bifrostApiKey).toBe("vk-key-repo");
    void ctx;
  });

  test("body agent override beats the trigger's stored agent", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-override");

    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-key-test",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: { "x-macaroon": "test-mac" },
      runId: "run-test",
      agentName: "test-agent",
    });

    mockTriggersResponse([
      { ref_id: TRIGGER_ID, source: "repo_agent", agent: "build-agent" },
    ]);
    mockStakworkSuccess("proj-override-1");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
      { agent: "test-agent" },
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);

    expect(getBifrostForLLM).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentName: "test-agent" }),
    );
    void ctx;
  });

  test("an invalid stored agent (e.g. wfe-agent) falls back to the source map", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-wfe");

    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-key-repo2",
      baseUrl: "https://bifrost.example.com/anthropic/v1",
      headers: { "x-macaroon": "test-mac" },
      runId: "run-repo2",
      agentName: "repo-agent",
    });

    mockTriggersResponse([
      { ref_id: TRIGGER_ID, source: "repo_agent", agent: "wfe-agent" },
    ]);
    mockStakworkSuccess("proj-wfe-1");

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(200);

    // wfe-agent is a capture name but not a BifrostAgentName — identity
    // must resolve straight to the source-mapped default, one call only.
    expect(getBifrostForLLM).toHaveBeenCalledTimes(1);
    expect(getBifrostForLLM).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentName: "repo-agent" }),
    );
    void ctx;
  });

  test("returns 502 when Jarvis trigger fetch fails", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-502");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(502);
    void ctx;
  });

  test("returns 502 when Stakwork dispatch fails", async () => {
    const ctx = await createTestContext(RAW_KEY_1, SWARM_NAME_1 + "-run-sw-fail");

    mockTriggersResponse([{ ref_id: TRIGGER_ID, source: "repo_agent" }]);
    // Stakwork fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const req = makeRequest(
      "POST",
      `http://localhost/api/gateway/evals/${SET_ID}/requirements/${REQ_ID}/run`,
      RAW_KEY_1,
    );
    const res = await runEvals(req as any, {
      params: Promise.resolve({ setId: SET_ID, reqId: REQ_ID }),
    });
    expect(res.status).toBe(502);
    void ctx;
  });
});
