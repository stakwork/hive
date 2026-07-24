/**
 * Integration tests for POST /api/agent-runs/webhook
 *
 * Tests cover:
 * - Webhook auth (token in header, constant-time compare, tokenHash in where-clause)
 * - Rate limiting (429 before lookup/claim)
 * - Both delivery paths and the race (inline-then-webhook, webhook-then-inline)
 * - Payload hardening (oversized/malformed/non-string bodies)
 * - Failure surfacing (failed/aborted → failure note)
 * - Isolation (missing id → 400, missing token → 401, wrong token → 401)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-runs/webhook/route";
import { db } from "@/lib/db";
import { AgentRunStatus } from "@prisma/client";
import crypto from "crypto";

// ── External deps mocks ───────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue({}) },
  getCanvasConversationChannelName: vi.fn((id: string) => `canvas-conversation-${id}`),
  PUSHER_EVENTS: { CANVAS_CONVERSATION_UPDATED: "canvas-conversation-updated" },
  notifyCanvasConversationUpdated: vi.fn(),
}));

// Rate limit: default allow — specific tests override
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { checkRateLimit } from "@/lib/rate-limit";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";

// ── Helpers ───────────────────────────────────────────────────────────────────

let installationIdCounter = 888000;
function nextInstallationId() { return installationIdCounter++; }

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createOrg() {
  return db.sourceControlOrg.create({
    data: {
      githubLogin: `test-org-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: "Test Org",
      avatarUrl: "https://avatars.example.com/test",
    },
  });
}

async function createUser() {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return db.user.create({
    data: { email: `test-${ts}@example.com`, name: `Test User ${ts}` },
  });
}

async function createConversation(orgId: string, userId: string) {
  return db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      messages: [],
      followUpQuestions: [],
    },
  });
}

async function createAgentRun({
  conversationId,
  orgId,
  userId,
  rawToken,
  status = "PENDING",
}: {
  conversationId: string;
  orgId: string;
  userId: string;
  rawToken: string;
  status?: AgentRunStatus;
}) {
  return db.agentRun.create({
    data: {
      tokenHash: hashToken(rawToken),
      conversationId,
      orgId,
      userId,
      title: "Test workflow explorer run",
      status,
    },
  });
}

function makeWebhookRequest({
  runId,
  token,
  body,
  url,
}: {
  runId?: string;
  token?: string;
  body?: unknown;
  url?: string;
}) {
  const baseUrl = url ?? `http://localhost:3000/api/agent-runs/webhook${runId ? `?id=${runId}` : ""}`;
  return new NextRequest(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-agent-run-token": token } : {}),
    },
    body: JSON.stringify(body ?? { status: "success", content: "Result text" }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agent-runs/webhook", () => {
  let org: Awaited<ReturnType<typeof createOrg>>;
  let user: Awaited<ReturnType<typeof createUser>>;
  let conversation: Awaited<ReturnType<typeof createConversation>>;
  const rawToken = "test-raw-token-abcdef1234567890";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    org = await createOrg();
    user = await createUser();
    conversation = await createConversation(org.id, user.id);
  });

  // ── Auth & validation ──────────────────────────────────────────────────────

  it("returns 400 when id is missing from query string", async () => {
    const req = makeWebhookRequest({ token: rawToken, url: "http://localhost:3000/api/agent-runs/webhook" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when x-agent-run-token header is missing", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({ runId: agentRun.id });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/missing auth token/i);
  });

  it("returns 404 when the runId does not exist", async () => {
    const req = makeWebhookRequest({ runId: "nonexistent-run-id", token: rawToken });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 401 when the token is wrong", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({ runId: agentRun.id, token: "wrong-token" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  it("returns 429 before any DB lookup when rate limit is hit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });
    // Even with a real run id + correct token, rate limit fires first
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({ runId: agentRun.id, token: rawToken });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);
    // Rate limit fires before any DB write, so the row stays PENDING
    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("PENDING");
  });

  it("includes Retry-After header when rate limit is hit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 45 });
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({ runId: agentRun.id, token: rawToken });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
  });

  // ── Success delivery path ──────────────────────────────────────────────────

  it("claims PENDING → DELIVERED_WEBHOOK and fans out on success payload", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", content: "Great research result here." },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Row claimed
    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("DELIVERED_WEBHOOK");

    // Message fanned out
    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toBe("Great research result here.");
    expect((msg.source as Record<string, unknown>).kind).toBe("agent_run");
    expect((msg.source as Record<string, unknown>).runId).toBe(agentRun.id);
    expect((msg.source as Record<string, unknown>).status).toBe("success");

    // Pusher notified
    expect(notifyCanvasConversationUpdated).toHaveBeenCalledWith(conversation.id, "agent_run");
  });

  it("uses final_answer as fallback when content is missing", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", final_answer: "Fallback result." },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toBe("Fallback result.");
  });

  // ── Failure delivery path ──────────────────────────────────────────────────

  it("claims PENDING → FAILED and posts failure note on non-success status", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "failed" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("FAILED");

    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toContain("did not complete");
    expect((msg.source as Record<string, unknown>).status).toBe("failed");
  });

  it("treats aborted status as FAILED", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "aborted" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("FAILED");
  });

  // ── Exactly-once / race conditions ────────────────────────────────────────

  it("returns 200 no-op when inline already claimed the row (webhook-then-inline race)", async () => {
    // Pre-claim as DELIVERED_INLINE (simulating the inline path won)
    const agentRun = await createAgentRun({
      conversationId: conversation.id,
      orgId: org.id,
      userId: user.id,
      rawToken,
      status: "DELIVERED_INLINE",
    });
    const req = makeWebhookRequest({ runId: agentRun.id, token: rawToken });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toBe("already claimed");

    // Conversation stays empty — no duplicate fan-out
    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    expect(messages).toHaveLength(0);

    // Pusher NOT called
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  it("returns 200 no-op when cancellation already claimed the row as FAILED", async () => {
    const agentRun = await createAgentRun({
      conversationId: conversation.id,
      orgId: org.id,
      userId: user.id,
      rawToken,
      status: "FAILED",
    });
    const req = makeWebhookRequest({ runId: agentRun.id, token: rawToken });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toBe("already claimed");
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  it("fan-out is idempotent — a second webhook call for the same runId is a no-op", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req1 = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", content: "Result A" },
    });
    const req2 = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", content: "Result B" },
    });

    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    // Only one message in the conversation
    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toBe("Result A"); // first call wins
  });

  // ── Payload hardening ──────────────────────────────────────────────────────

  it("rejects oversized content — demotes to FAILED", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const oversized = "x".repeat(128 * 1024 + 1); // > MAX_CONTENT_LENGTH
    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", content: oversized },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Row transitions to FAILED (oversized content treated as failure)
    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("FAILED");
  });

  it("returns 400 on invalid JSON body", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const req = new NextRequest(`http://localhost:3000/api/agent-runs/webhook?id=${agentRun.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-run-token": rawToken,
      },
      body: "not-json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Ownership re-validation (IDOR guard) ──────────────────────────────────

  it("fan-out bails non-fatally when conversation org/user does not match the row", async () => {
    // Create a second org/user and conversation they do NOT own
    const otherOrg = await createOrg();
    const otherUser = await createUser();

    // Row has org2/user2 but the conversation belongs to org1/user1
    const agentRun = await db.agentRun.create({
      data: {
        tokenHash: hashToken(rawToken),
        conversationId: conversation.id, // real conversation
        orgId: otherOrg.id,              // WRONG org — mismatch
        userId: otherUser.id,            // WRONG user — mismatch
        title: "Test",
      },
    });

    const req = makeWebhookRequest({
      runId: agentRun.id,
      token: rawToken,
      body: { status: "success", content: "Should not appear" },
    });
    const res = await POST(req);
    // Webhook still returns 200 (the claim succeeded atomically)
    expect(res.status).toBe(200);

    // But no message was appended — the fan-out guard caught the mismatch
    const conv = await db.sharedConversation.findUnique({ where: { id: conversation.id } });
    const messages = conv?.messages as unknown[];
    expect(messages).toHaveLength(0);
  });

  // ── tokenHash gating of the claim ─────────────────────────────────────────

  it("wrong token cannot claim the row even if id is correct", async () => {
    const agentRun = await createAgentRun({ conversationId: conversation.id, orgId: org.id, userId: user.id, rawToken });
    const wrongToken = "completely-wrong-token";
    const req = makeWebhookRequest({ runId: agentRun.id, token: wrongToken });
    const res = await POST(req);
    // Auth check rejects before the claim
    expect(res.status).toBe(401);

    // Row stays PENDING
    const row = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    expect(row?.status).toBe("PENDING");
  });
});
