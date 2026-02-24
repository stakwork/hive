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

describe("Feature Chat POST Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock feature lookup
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

    // Mock artifact lookup
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);

    // Mock chat history
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  });

  it("should accept and persist replyId in chat message", async () => {
    const mockCreatedMessage = {
      id: "new-message-id",
      featureId: "feature-123",
      message: "This is my answer",
      role: ChatRole.USER,
      userId: "user-123",
      contextTags: "[]",
      status: ChatStatus.SENT,
      sourceWebsocketID: null,
      replyId: "original-message-id",
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
    };

    vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

    const request = new NextRequest("http://localhost/api/features/feature-123/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "This is my answer",
        contextTags: [],
        replyId: "original-message-id",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const params = Promise.resolve({ featureId: "feature-123" });
    const response = await POST(request, { params });

    // Verify response is successful
    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
    expect(responseData.message.replyId).toBe("original-message-id");

    // Verify db.chatMessage.create was called with replyId
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: {
        featureId: "feature-123",
        message: "This is my answer",
        role: ChatRole.USER,
        userId: "user-123",
        contextTags: "[]",
        status: ChatStatus.SENT,
        sourceWebsocketID: undefined,
        replyId: "original-message-id",
      },
      include: {
        artifacts: true,
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });
  });

  it("should handle messages without replyId", async () => {
    const mockCreatedMessage = {
      id: "new-message-id",
      featureId: "feature-123",
      message: "Regular message",
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
    };

    vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

    const request = new NextRequest("http://localhost/api/features/feature-123/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "Regular message",
        contextTags: [],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const params = Promise.resolve({ featureId: "feature-123" });
    const response = await POST(request, { params });

    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
    expect(responseData.message.replyId).toBeNull();

    // Verify db.chatMessage.create was called without replyId (undefined is fine)
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: {
        featureId: "feature-123",
        message: "Regular message",
        role: ChatRole.USER,
        userId: "user-123",
        contextTags: "[]",
        status: ChatStatus.SENT,
        sourceWebsocketID: undefined,
        replyId: undefined,
      },
      include: {
        artifacts: true,
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });
  });

  it("should preserve other fields when replyId is present", async () => {
    const mockCreatedMessage = {
      id: "new-message-id",
      featureId: "feature-123",
      message: "Answer with context",
      role: ChatRole.USER,
      userId: "user-123",
      contextTags: JSON.stringify([{ type: "code", value: "example" }]),
      status: ChatStatus.SENT,
      sourceWebsocketID: "ws-123",
      replyId: "original-message-id",
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
    };

    vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

    const request = new NextRequest("http://localhost/api/features/feature-123/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "Answer with context",
        contextTags: [{ type: "code", value: "example" }],
        sourceWebsocketID: "ws-123",
        replyId: "original-message-id",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const params = Promise.resolve({ featureId: "feature-123" });
    const response = await POST(request, { params });

    expect(response.status).toBe(201);

    // Verify all fields are preserved
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: {
        featureId: "feature-123",
        message: "Answer with context",
        role: ChatRole.USER,
        userId: "user-123",
        contextTags: JSON.stringify([{ type: "code", value: "example" }]),
        status: ChatStatus.SENT,
        sourceWebsocketID: "ws-123",
        replyId: "original-message-id",
      },
      include: {
        artifacts: true,
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });
  });
});
