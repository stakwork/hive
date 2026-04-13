import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { callStakworkAPI } from "@/services/task-workflow";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findUnique: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn(), findMany: vi.fn() },
    artifact: { findFirst: vi.fn() },
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
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMessage() as any);
  });

  it("passes mergedHistory (db + body) to callStakworkAPI when history provided in body", async () => {
    // DB has one existing ASSISTANT message with a PLAN artifact (successful exchange)
    const dbMsg = {
      id: "msg-db-1",
      message: "Existing DB message",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      createdAt: new Date("2025-01-01T09:00:00Z"),
      contextTags: "[]",
      artifacts: [{ id: "art-1", type: ArtifactType.PLAN, content: "{}", icon: null }],
      attachments: [],
    };
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([dbMsg] as any);

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
    // DB has two messages: a USER + ASSISTANT pair with a PLAN artifact (successful exchange)
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
        artifacts: [{ id: "art-2", type: ArtifactType.PLAN, content: "{}", icon: null }],
        attachments: [],
      },
    ];
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(dbMsgs as any);

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
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMessage() as any);
  });

  it("forwards isPrototype: true to callStakworkAPI when dbHistory is empty (first message)", async () => {
    // No prior DB messages — this is the first message in the conversation
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

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
    // DB already has a successful ASSISTANT message (with PLAN artifact) — not the first message
    const dbMsg = {
      id: "msg-db-1",
      message: "Previous message",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      createdAt: new Date("2025-01-01T09:00:00Z"),
      contextTags: "[]",
      artifacts: [{ id: "art-1", type: ArtifactType.PLAN, content: "{}", icon: null }],
      attachments: [],
    };
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([dbMsg] as any);

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
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

    const request = createChatRequest({ message: "Standard plan message" });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.isPrototype).toBeFalsy();
  });
});

describe("POST /api/features/[featureId]/chat — model forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMessage() as any);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  });

  it("forwards model from request body to callStakworkAPI as taskModel", async () => {
    const request = createChatRequest({ message: "Plan this feature", model: "opus" });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.taskModel).toBe("opus");
  });

  it("passes undefined taskModel to callStakworkAPI when model is not in request body", async () => {
    const request = createChatRequest({ message: "Plan this feature" });

    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(201);

    expect(mockCallStakworkAPI).toHaveBeenCalledOnce();
    const callArg = mockCallStakworkAPI.mock.calls[0][0];
    expect(callArg.taskModel).toBeUndefined();
  });

  it.each(["sonnet", "opus", "haiku", "kimi", "gemini", "gpt"] as const)(
    "forwards model '%s' correctly",
    async (model) => {
      const request = createChatRequest({ message: "Test", model });

      const response = await POST(request, { params: featureParams });
      expect(response.status).toBe(201);

      const callArg = mockCallStakworkAPI.mock.calls[0][0];
      expect(callArg.taskModel).toBe(model);
    }
  );
});
