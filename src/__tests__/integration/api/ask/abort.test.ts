/**
 * Integration tests for POST /api/ask/abort
 *
 * Scope (auth + authorization, idempotency, proxy, races):
 *   - unauthenticated → 401
 *   - authenticated non-member of org → 404 before any activeRuns/cred read
 *   - non-participant of a private shared conversation → 404 (IDOR)
 *   - shared-room participant who didn't start the run CAN stop it
 *   - repeat Stop clicks are idempotent 200s (never 429)
 *   - proxy targets re-resolved Swarm URL (not persisted) + x-api-token
 *   - Stop before request_id persists → pending-abort intent recorded
 *   - no activeRuns in response body
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  createPostRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { POST } from "@/app/api/ask/abort/route";

// ── Mock external deps ────────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  PUSHER_EVENTS: {
    CANVAS_RUN_ACTIVE: "canvas-run-active",
    CANVAS_CONVERSATION_UPDATED: "canvas-conversation-updated",
  },
  getCanvasConversationChannelName: (id: string) => `canvas-conversation-${id}`,
}));

// Mock redis (rate-limit)
vi.mock("@/lib/redis", () => ({
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
}));

// fetchMock — tracks outbound swarm abort calls
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  global.fetch = fetchMock;
});

// ── helpers ───────────────────────────────────────────────────────────────────

let orgIdCounter = 700_000;
function nextInstallationId() { return orgIdCounter++; }

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
      avatarUrl: `https://example.com/avatar`,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string) {
  const slug = `abort-test-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

async function createActiveSwarm(workspaceId: string) {
  return createTestSwarm({
    workspaceId,
    status: "ACTIVE",
    swarmUrl: "https://swarm.mock.test:3355",
    swarmApiKey: "test-swarm-key",
    poolName: "test-pool",
  });
}

async function createConversation(opts: {
  userId: string;
  orgId: string;
  isShared?: boolean;
  activeRuns?: Record<string, unknown>;
}) {
  return db.sharedConversation.create({
    data: {
      userId: opts.userId,
      sourceControlOrgId: opts.orgId,
      isShared: opts.isShared ?? false,
      messages: [],
      followUpQuestions: [],
      source: "org-canvas",
      activeRuns: opts.activeRuns ? (opts.activeRuns as object) : null,
    },
  });
}

function abortBody(conversationId: string, orgId: string, turnId?: string) {
  return { conversationId, orgId, turnId };
}

const createdOrgIds: string[] = [];
afterEach(async () => {
  for (const id of createdOrgIds) {
    await db.sourceControlOrg.delete({ where: { id } }).catch(() => {});
  }
  createdOrgIds.length = 0;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/ask/abort", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const req = createPostRequest("/api/ask/abort", {
      conversationId: "conv-1",
      orgId: "org-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not a member of the org", async () => {
    const user = await createTestUser();
    const org = await createOrg(`abort-non-member-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: user.id, email: user.email ?? "u@test.com", name: user.name ?? "U" },
      abortBody("conv-does-not-exist", org.id),
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a conversation not owned by the user in a private conv (IDOR)", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const org = await createOrg(`abort-idor-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    await createWorkspaceInOrg(owner.id, org.id);
    // attacker also a member of the org (so org check passes)
    await createWorkspaceInOrg(attacker.id, org.id);

    // Private conversation owned by owner
    const conv = await createConversation({ userId: owner.id, orgId: org.id, isShared: false });

    // Attacker tries to abort it
    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: attacker.id, email: attacker.email ?? "a@test.com", name: attacker.name ?? "A" },
      abortBody(conv.id, org.id),
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("allows a shared-room participant who didn't start the run to stop it", async () => {
    const owner = await createTestUser();
    const participant = await createTestUser();
    const org = await createOrg(`abort-shared-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    await createWorkspaceInOrg(participant.id, org.id);
    await createActiveSwarm(ws.id);

    const runEntry = {
      requestId: "req-shared-1",
      workspaceId: ws.id,
      startedAt: new Date().toISOString(),
    };
    const conv = await createConversation({
      userId: owner.id,
      orgId: org.id,
      isShared: true,
      activeRuns: { runs: { "req-shared-1": runEntry } },
    });

    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: participant.id, email: participant.email ?? "p@test.com", name: participant.name ?? "P" },
      abortBody(conv.id, org.id),
    );
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("proxies abort to swarm with x-api-token (re-resolved from Swarm record)", async () => {
    const user = await createTestUser();
    const org = await createOrg(`abort-proxy-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    await createActiveSwarm(ws.id);

    const runEntry = {
      requestId: "req-proxy-1",
      workspaceId: ws.id,
      startedAt: new Date().toISOString(),
    };
    const conv = await createConversation({
      userId: user.id,
      orgId: org.id,
      isShared: false,
      activeRuns: { runs: { "req-proxy-1": runEntry } },
    });

    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: user.id, email: user.email ?? "u@test.com", name: user.name ?? "U" },
      abortBody(conv.id, org.id),
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify outbound call was made (to the swarm, not to a persisted URL)
    const abortCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/repo/agent/abort"),
    );
    expect(abortCall).toBeDefined();
    // Body should contain the request_id
    const callBody = JSON.parse(abortCall![1].body);
    expect(callBody.request_id).toBe("req-proxy-1");
    // Headers should contain x-api-token
    expect(abortCall![1].headers["x-api-token"]).toBeDefined();
    expect(abortCall![1].headers["x-api-token"]).not.toBe("");
  });

  it("is idempotent — repeat Stop clicks return 200 without 429", async () => {
    const user = await createTestUser();
    const org = await createOrg(`abort-idem-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    await createActiveSwarm(ws.id);

    const runEntry = {
      requestId: "req-idem-1",
      workspaceId: ws.id,
      startedAt: new Date().toISOString(),
      abortRequested: true, // already aborted
    };
    const conv = await createConversation({
      userId: user.id,
      orgId: org.id,
      isShared: false,
      activeRuns: { runs: { "req-idem-1": runEntry } },
    });

    // Second Stop click — all runs already have abortRequested.
    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: user.id, email: user.email ?? "u@test.com", name: user.name ?? "U" },
      abortBody(conv.id, org.id),
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(429);
  });

  it("records pending-abort intent when Stop is pressed before request_id is registered", async () => {
    const user = await createTestUser();
    const org = await createOrg(`abort-race-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    await createWorkspaceInOrg(user.id, org.id);

    // No active runs yet
    const conv = await createConversation({
      userId: user.id,
      orgId: org.id,
      isShared: false,
    });

    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: user.id, email: user.email ?? "u@test.com", name: user.name ?? "U" },
      abortBody(conv.id, org.id, "turn-xyz"),
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aborted).toBe(0); // no runs to abort yet

    // Verify pending-abort intent was written to DB.
    const updated = await db.sharedConversation.findUnique({
      where: { id: conv.id },
      select: { activeRuns: true },
    });
    const doc = updated?.activeRuns as { pendingAbortIntent?: { turnId: string } } | null;
    expect(doc?.pendingAbortIntent?.turnId).toBe("turn-xyz");
  });

  it("response body never contains active_runs column data", async () => {
    const user = await createTestUser();
    const org = await createOrg(`abort-secret-${generateUniqueId()}`);
    createdOrgIds.push(org.id);

    const ws = await createWorkspaceInOrg(user.id, org.id);
    await createActiveSwarm(ws.id);

    const runEntry = {
      requestId: "req-secret-1",
      workspaceId: ws.id,
      startedAt: new Date().toISOString(),
    };
    const conv = await createConversation({
      userId: user.id,
      orgId: org.id,
      activeRuns: { runs: { "req-secret-1": runEntry } },
    });

    const req = createAuthenticatedPostRequest(
      "/api/ask/abort",
      { id: user.id, email: user.email ?? "u@test.com", name: user.name ?? "U" },
      abortBody(conv.id, org.id),
    );
    const res = await POST(req);
    const body = await res.json();

    // Response must not leak active_runs map, workspaceId, or requestId correlators.
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("req-secret-1");
    expect(bodyStr).not.toContain("activeRuns");
    expect(bodyStr).not.toContain("active_runs");
    expect(bodyStr).not.toContain(ws.id);
  });
});
