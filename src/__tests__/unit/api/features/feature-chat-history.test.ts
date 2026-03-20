import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { callStakworkAPI } from "@/services/task-workflow";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {features: { findUnique: vi.fn(), update: vi.fn() },chat_messages: { create: vi.fn(), findMany: vi.fn() },artifacts: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/task-workflow", () => ({
  callStakworkAPI: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status" },
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/helpers/repository", () => ({
  joinRepoUrls: vi.fn().mockReturnValue(""),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://test.stakwork.com",
    STAKWORK_WORKFLOW_ID: "123",
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockCallStakworkAPI = vi.mocked(callStakworkAPI);

function makeChatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-db-1",
    featureId: "feature-123",
    userId: "user-123",
    message: "DB message",
    role: ChatRole.USER,
    status: ChatStatus.SENT,
    contextTags: "[]",
    sourceWebsocketID: null,
    replyId: null,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    updatedAt: new Date("2025-01-01T10:00:00Z"),
    artifacts: [],
    attachments: [],
    createdBy: { id: "user-123", name: "Test User", email: "test@example.com", image: null },
    ...overrides,
  };
}

function makeFeature() {
  return {
    id: "feature-123",
    workspaceId: "workspace-1",
    planUpdatedAt: null,
    updatedAt: new Date(),
    phases: [],
    workspace: {
      slug: "test-workspace",
      ownerId: "user-123",
      swarm: {
        swarmUrl: "https://swarm.test.com/api",
        swarmSecretAlias: "alias",
        poolName: "pool-1",
        id: "swarm-id",
      },
      members: [],
      repositories: [],
    },
  };
}

function createChatRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/features/feature-123/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const featureParams = Promise.resolve({ featureId: "feature-123" });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/features/[featureId]/chat — history merging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.features.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifacts.findFirst).mockResolvedValue(null);
    vi.mocked(db.features.update).mockResolvedValue({} as any);
    vi.mocked(db.chat_messages.create).mockResolvedValue(makeChatMessage() as any);
  });

  it("passes mergedHistory (db + body) to callStakworkAPI when history provided in body", async () => {
    // DB has one existing message
    const dbMsg = {
      id: "msg-db-1",
      message: "Existing DB message",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      createdAt: new Date("2025-01-01T09:00:00Z"),
      contextTags: "[]",
      artifacts: [],
      attachments: [],
    };
    vi.mocked(db.chat_messages.findMany).mockResolvedValue([dbMsg] as any);

    const bodyHistory = [
      { role: "user", content: "Prototype message 1" },
      { role: "assistant", content: "Prototype reply 1" },
    ];

    const request = createChatRequest({
      message: "Seed Plan Mode",
      history: bodyHistory,
    });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];

    // DB history comes first, then body history
    expect(callArg.history).toHaveLength(3); // 1 DB + 2 body
    expect(callArg.history[0]).toMatchObject({ id: "msg-db-1" }); // DB record
    expect(callArg.history[1]).toEqual({ role: "user", content: "Prototype message 1" });
    expect(callArg.history[2]).toEqual({ role: "assistant", content: "Prototype reply 1" });
  });

  it("behaves identically to current implementation when no history in body", async () => {
    // DB has two messages
    const dbMsgs = [
      {
        id: "msg-db-1",
        message: "First message",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date("2025-01-01T09:00:00Z"),
        contextTags: "[]",
        artifacts: [],
        attachments: [],
      },
      {
        id: "msg-db-2",
        message: "Second message",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        createdAt: new Date("2025-01-01T09:01:00Z"),
        contextTags: "[]",
        artifacts: [],
        attachments: [],
      },
    ];
    vi.mocked(db.chat_messages.findMany).mockResolvedValue(dbMsgs as any);

    const request = createChatRequest({ message: "New message without history" });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];

    // Only DB history — nothing extra
    expect(callArg.history).toHaveLength(2);
    expect(callArg.history[0]).toMatchObject({ id: "msg-db-1" });
    expect(callArg.history[1]).toMatchObject({ id: "msg-db-2" });
  });
});

describe("POST /api/features/[featureId]/chat — isPrototype flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.features.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifacts.findFirst).mockResolvedValue(null);
    vi.mocked(db.features.update).mockResolvedValue({} as any);
    vi.mocked(db.chat_messages.create).mockResolvedValue(makeChatMessage() as any);
  });

  it("forwards isPrototype: true to callStakworkAPI when dbHistory is empty (first message)", async () => {
    // No prior DB messages — this is the first message in the conversation
    vi.mocked(db.chat_messages.findMany).mockResolvedValue([]);

    const request = createChatRequest({
      message: "Seed Plan Mode",
      history: [{ role: "user", content: "prototype msg" }],
      isPrototype: true,
    });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.isPrototype).toBe(true);
  });

  it("does NOT forward isPrototype when dbHistory is non-empty (subsequent message)", async () => {
    // DB already has a message — this is not the first message
    const dbMsg = {
      id: "msg-db-1",
      message: "Previous message",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      createdAt: new Date("2025-01-01T09:00:00Z"),
      contextTags: "[]",
      artifacts: [],
      attachments: [],
    };
    vi.mocked(db.chat_messages.findMany).mockResolvedValue([dbMsg] as any);

    const request = createChatRequest({
      message: "Follow-up message",
      isPrototype: true,
    });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.isPrototype).toBeFalsy();
  });

  it("does NOT forward isPrototype for a standard (non-prototype) plan flow", async () => {
    // No prior DB messages but isPrototype not sent
    vi.mocked(db.chat_messages.findMany).mockResolvedValue([]);

    const request = createChatRequest({ message: "Standard plan message" });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.isPrototype).toBeFalsy();
  });
});
