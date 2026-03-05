import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock S3 service
const mockS3Service = {
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

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
      update: vi.fn(),
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

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: vi.fn().mockReturnValue("feature-channel"),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status-update" },
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

describe("Feature Chat POST Route - attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.feature.findUnique).mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      workflowStatus: "PENDING",
      planUpdatedAt: null,
      updatedAt: new Date(),
      phases: [],
      workspace: {
        slug: "test-workspace",
        ownerId: "user-123",
        swarm: null,
        members: [],
        repositories: [],
      },
    } as any);

    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
      "https://bucket.s3.amazonaws.com/presigned-download-url",
    );
  });

  it("should return 400 when neither message nor attachments are provided", async () => {
    const request = createChatRequest({});

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Message or attachment is required");
  });

  it("should return 201 when only attachments are provided (no message)", async () => {
    const attachments = [
      { path: "uploads/ws/swarm/feature-123/photo.jpg", filename: "photo.jpg", mimeType: "image/jpeg", size: 1024 },
    ];

    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({
        message: "",
        attachments: attachments.map((a, i) => ({ id: `att-${i}`, ...a, createdAt: new Date(), updatedAt: new Date(), messageId: "new-message-id" })),
      }) as any,
    );

    const request = createChatRequest({ message: "", attachments });

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
  });

  it("should call db.chatMessage.create with attachments.create block", async () => {
    const attachments = [
      { path: "uploads/ws/swarm/feature-123/photo.jpg", filename: "photo.jpg", mimeType: "image/jpeg", size: 1024 },
      { path: "uploads/ws/swarm/feature-123/diagram.png", filename: "diagram.png", mimeType: "image/png", size: 2048 },
    ];

    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({
        message: "Here are my images",
        attachments: attachments.map((a, i) => ({
          id: `att-${i}`,
          ...a,
          createdAt: new Date(),
          updatedAt: new Date(),
          messageId: "new-message-id",
        })),
      }) as any,
    );

    const request = createChatRequest({ message: "Here are my images", attachments });

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: {
            create: [
              { path: attachments[0].path, filename: attachments[0].filename, mimeType: attachments[0].mimeType, size: attachments[0].size },
              { path: attachments[1].path, filename: attachments[1].filename, mimeType: attachments[1].mimeType, size: attachments[1].size },
            ],
          },
        }),
      }),
    );
  });

  it("should call generatePresignedDownloadUrl for each attachment path when Stakwork is enabled", async () => {
    // Enable Stakwork
    const { config } = await import("@/config/env");
    vi.mocked(config as any).STAKWORK_API_KEY = "key";
    vi.mocked(config as any).STAKWORK_BASE_URL = "https://api.stakwork.com";
    vi.mocked(config as any).STAKWORK_WORKFLOW_ID = "42";

    const attachments = [
      { path: "uploads/ws/swarm/feature-123/img1.jpg", filename: "img1.jpg", mimeType: "image/jpeg", size: 1024 },
      { path: "uploads/ws/swarm/feature-123/img2.jpg", filename: "img2.jpg", mimeType: "image/jpeg", size: 2048 },
    ];

    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({
        message: "look at these",
        attachments: attachments.map((a, i) => ({
          id: `att-${i}`,
          ...a,
          createdAt: new Date(),
          updatedAt: new Date(),
          messageId: "new-message-id",
        })),
      }) as any,
    );
    vi.mocked(db.feature.findUnique).mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      workflowStatus: "PENDING",
      planUpdatedAt: null,
      updatedAt: new Date(),
      phases: [],
      workspace: {
        slug: "test-workspace",
        ownerId: "user-123",
        swarm: { swarmUrl: "https://swarm.example.com/api", swarmSecretAlias: "alias", poolName: "pool", id: "swarm-1" },
        members: [],
        repositories: [],
      },
    } as any);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);

    const request = createChatRequest({ message: "look at these", attachments });

    await POST(request, { params: featureParams });

    expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
    expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(attachments[0].path);
    expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(attachments[1].path);

    // Reset config
    vi.mocked(config as any).STAKWORK_API_KEY = null;
    vi.mocked(config as any).STAKWORK_BASE_URL = null;
    vi.mocked(config as any).STAKWORK_WORKFLOW_ID = null;
  });

  it("should not include attachments.create when no attachments are sent", async () => {
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      mockChatMessage({ message: "Just a message" }) as any,
    );

    const request = createChatRequest({ message: "Just a message" });

    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          attachments: expect.anything(),
        }),
      }),
    );
  });
});
