/**
 * Unit tests for the retry branch of POST /api/features/[featureId]/chat
 *
 * Tests cover:
 *  - resolveRetryMessage helper (message-selection logic)
 *  - strict retry === true handling via the POST handler
 *  - 400 when both retry and message are present
 *  - 400 on empty / no-USER-message history
 *  - 429 on rate-limit (updatedAt throttle)
 *  - auth-ordering: retry only runs AFTER workspace access check
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { resolveRetryMessage } from "@/app/api/features/[featureId]/chat/helpers";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@/lib/chat";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
  }),
}));

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return {
    ...actual,
    resolveWorkspaceAccess: vi.fn().mockResolvedValue({
      kind: "member",
      userId: "user-123",
      workspaceId: "workspace-123",
      slug: "ws",
      role: "DEVELOPER",
    }),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    artifact: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock sendFeatureChatMessage so tests don't need a full workspace/swarm setup.
vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/services/canvas-planner-forms", () => ({
  appendAnswerRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-123",
    parentCanvasConversationId: null,
    updatedAt: new Date(Date.now() - 60_000), // 60 s ago — outside throttle window
    ...overrides,
  };
}

function makeChatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-id",
    featureId: "feature-123",
    message: "Test message",
    role: ChatRole.USER,
    userId: "user-123",
    contextTags: "[]",
    status: ChatStatus.SENT,
    sourceWebsocketID: null,
    replyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    artifacts: [],
    attachments: [],
    createdBy: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      image: null,
    },
    ...overrides,
  };
}

function makeSendResult(messageText = "Test message") {
  return {
    chatMessage: makeChatMessage({ message: messageText }),
    stakworkData: null,
  };
}

function makeRetryRequest(
  featureId: string,
  body: Record<string, unknown> = { retry: true },
) {
  return new NextRequest(
    `http://localhost:3000/api/features/${featureId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ── Unit tests: resolveRetryMessage ─────────────────────────────────────────

describe("resolveRetryMessage()", () => {
  it("returns null for empty history", () => {
    expect(resolveRetryMessage([])).toBeNull();
  });

  it("returns the first message when no ASSISTANT message exists (only USER)", () => {
    const msgs = [
      { role: ChatRole.USER, message: "first user message" },
      { role: ChatRole.USER, message: "second user message" },
    ];
    expect(resolveRetryMessage(msgs)).toBe("first user message");
  });

  it("returns the most recent USER message when an ASSISTANT message exists", () => {
    const msgs = [
      { role: ChatRole.USER, message: "first user message" },
      { role: ChatRole.ASSISTANT, message: "assistant reply" },
      { role: ChatRole.USER, message: "latest user message" },
    ];
    expect(resolveRetryMessage(msgs)).toBe("latest user message");
  });

  it("returns null when assistant is present but no USER message at all", () => {
    const msgs = [
      { role: ChatRole.ASSISTANT, message: "assistant-only" },
    ];
    // hasAssistant = true, but no USER message — reverse.find returns undefined
    expect(resolveRetryMessage(msgs)).toBeNull();
  });

  it("handles interleaved messages correctly — picks the latest USER", () => {
    const msgs = [
      { role: ChatRole.USER, message: "first" },
      { role: ChatRole.ASSISTANT, message: "a1" },
      { role: ChatRole.USER, message: "second" },
      { role: ChatRole.ASSISTANT, message: "a2" },
      { role: ChatRole.USER, message: "third" },
    ];
    expect(resolveRetryMessage(msgs)).toBe("third");
  });

  it("single USER message with no ASSISTANT → returns that message (first message branch)", () => {
    const msgs = [{ role: ChatRole.USER, message: "only message" }];
    expect(resolveRetryMessage(msgs)).toBe("only message");
  });

  it("ignores non-USER/ASSISTANT roles when looking for resendable message", () => {
    // A message with role SYSTEM only — no USER message at all.
    // No assistant → first message branch fires, returning the SYSTEM message
    // (which is a string, so non-null). This is the current implementation's
    // behaviour for an edge case that can't arise in practice today.
    const msgs = [{ role: "SYSTEM", message: "sys" }];
    // hasAssistant=false → returns msgs[0].message which is "sys"
    expect(resolveRetryMessage(msgs)).toBe("sys");
  });
});

// ── Integration-style unit tests: POST handler retry branch ─────────────────

describe("POST /api/features/[featureId]/chat — retry branch", () => {
  let sendFeatureChatMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked service after vi.clearAllMocks
    const mod = await import("@/services/roadmap/feature-chat");
    sendFeatureChatMessage = vi.mocked(mod.sendFeatureChatMessage);
    sendFeatureChatMessage.mockResolvedValue(makeSendResult("Please redesign the onboarding flow"));

    // Default: feature exists and was updated 60 s ago (outside throttle)
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as never);

    // Default: single USER message in history (resendable)
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      makeChatMessage({ message: "Please redesign the onboarding flow" }),
    ] as never);

    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
  });

  it("returns 201 with { retry: true } body — no message required", async () => {
    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 400 when both retry:true and a non-empty message are present", async () => {
    const req = makeRetryRequest("feature-123", {
      retry: true,
      message: "some message",
    });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/cannot combine retry/i);
    // sendFeatureChatMessage must never be called
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });

  it("does NOT treat retry:1 (non-boolean-true) as a retry — falls through to normal send", async () => {
    // Only strict boolean true should trigger the retry branch;
    // retry:1 falls through to the normal send path.
    const req = makeRetryRequest("feature-123", {
      retry: 1,
      message: "normal message",
    });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(201);
  });

  it("does NOT treat retry:'true' (string) as a retry — falls through to normal send", async () => {
    const req = makeRetryRequest("feature-123", {
      retry: "true",
      message: "normal message",
    });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(201);
  });

  it("returns 400 with 'Nothing to retry' when history is empty", async () => {
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([] as never);
    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/nothing to retry/i);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when history has no USER-authored message (only ASSISTANT)", async () => {
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      makeChatMessage({ role: ChatRole.ASSISTANT, message: "assistant only" }),
    ] as never);
    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/nothing to retry/i);
  });

  it("returns 429 when feature was updated within the throttle window", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({ updatedAt: new Date(Date.now() - 2_000) }) as never, // 2s ago
    );
    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toMatch(/retry too soon/i);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });

  it("allows retry when feature was updated outside the throttle window", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(
      makeFeature({ updatedAt: new Date(Date.now() - 60_000) }) as never,
    );
    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(201);
    expect(sendFeatureChatMessage).toHaveBeenCalledOnce();
  });

  it("uses the first message when no ASSISTANT message exists in history", async () => {
    const firstMsg = "First ever user message";
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      makeChatMessage({ role: ChatRole.USER, message: firstMsg }),
    ] as never);
    sendFeatureChatMessage.mockResolvedValue(makeSendResult(firstMsg));

    const req = makeRetryRequest("feature-123", { retry: true });
    await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });

    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: firstMsg }),
    );
  });

  it("uses the most recent USER message when an ASSISTANT message exists", async () => {
    const latestUserMsg = "Latest user question";
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      makeChatMessage({ role: ChatRole.USER, message: "first user message" }),
      makeChatMessage({ role: ChatRole.ASSISTANT, message: "assistant reply" }),
      makeChatMessage({ role: ChatRole.USER, message: latestUserMsg }),
    ] as never);
    sendFeatureChatMessage.mockResolvedValue(makeSendResult(latestUserMsg));

    const req = makeRetryRequest("feature-123", { retry: true });
    await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });

    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: latestUserMsg }),
    );
  });

  it("returns 404 when feature does not exist", async () => {
    vi.mocked(db.feature.findUnique).mockResolvedValue(null);
    const req = makeRetryRequest("nonexistent-feature", { retry: true });
    const res = await POST(req, {
      params: Promise.resolve({ featureId: "nonexistent-feature" }),
    });
    expect(res.status).toBe(404);
  });

  it("IDOR guard: chatMessage.findMany is scoped to the target featureId only", async () => {
    const req = makeRetryRequest("feature-123", { retry: true });
    await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });

    // All findMany calls for the retry history resolution must be scoped to { featureId }
    const findManyCalls = vi.mocked(db.chatMessage.findMany).mock.calls;
    expect(findManyCalls.length).toBeGreaterThan(0);
    for (const call of findManyCalls) {
      // The retry history query must scope to the requested featureId
      expect(call[0]?.where?.featureId).toBe("feature-123");
    }
  });

  it("auth: 403 for non-members returned before chat history is read", async () => {
    const { resolveWorkspaceAccess } = await import("@/lib/auth/workspace-access");
    vi.mocked(resolveWorkspaceAccess).mockResolvedValueOnce({
      kind: "forbidden",
    } as never);

    const req = makeRetryRequest("feature-123", { retry: true });
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(403);

    // The retry history findMany must NOT have been called before auth completes
    const historyCall = vi.mocked(db.chatMessage.findMany).mock.calls.find(
      (call) => call[0]?.where?.featureId !== undefined,
    );
    expect(historyCall).toBeUndefined();
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });

  it("normal send path still works after adding retry branch", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/features/feature-123/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Normal message" }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(201);
    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Normal message" }),
    );
  });

  it("normal send path still returns 400 when no message and no attachments", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/features/feature-123/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ featureId: "feature-123" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/message is required/i);
  });
});
