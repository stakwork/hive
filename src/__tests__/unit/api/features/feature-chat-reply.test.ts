import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock dependencies
vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
  }),
}));

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

vi.mock("@/services/task-workflow", () => ({
  callStakworkAPI: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: null,
    STAKWORK_BASE_URL: null,
    STAKWORK_WORKFLOW_ID: null,
  },
}));

function mockChatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "new-message-id",
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

function createChatRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/features/feature-123/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const featureParams = Promise.resolve({ featureId: "feature-123" });

describe("Feature Chat POST Route - replyId", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.feature.findUnique).mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      updatedAt: new Date(),
      phases: [],
      workspace: {
        slug: "test-workspace",
        ownerId: "user-123",
        swarm: null,
        repositories: [],
      },
    } as any);

    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  });

  it("should persist replyId when provided", async () => {
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({ message: "This is my answer", replyId: "original-message-id" }) as any,
    );

    const request = createChatRequest({
      message: "This is my answer",
      replyId: "original-message-id",
    });

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
    expect(responseData.message.replyId).toBe("original-message-id");

    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: "This is my answer",
          replyId: "original-message-id",
        }),
      }),
    );
  });

  it("should default replyId to undefined when not provided", async () => {
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({ message: "Regular message" }) as any,
    );

    const request = createChatRequest({ message: "Regular message" });

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
    expect(responseData.message.replyId).toBeNull();

    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: "Regular message",
          replyId: undefined,
        }),
      }),
    );
  });
});
