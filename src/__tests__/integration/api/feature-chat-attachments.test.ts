import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/chat/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { createPostRequest } from "@/__tests__/support/helpers";

// Mock S3 service
const mockS3Service = {
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

// Mock auth
vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn(),
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message", WORKFLOW_STATUS_UPDATE: "workflow-status-update" },
}));

// Mock Stakwork / external calls so we test only message persistence
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: null,
    STAKWORK_BASE_URL: null,
    STAKWORK_WORKFLOW_ID: null,
  },
}));

vi.mock("@/services/task-workflow", () => ({
  callStakworkAPI: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null),
  authOptions: {},
}));

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn().mockResolvedValue(null),
}));

describe("Feature Chat API - Attachment Support", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof db.feature.create>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    testFeature = await db.feature.create({
      data: {
        title: "Test Feature for Attachments",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        phases: {
          create: { name: "Phase 1", order: 0 },
        },
      },
    });

    // Default auth mock: return the test user
    const { requireAuthOrApiToken } = await import("@/lib/auth/api-token");
    vi.mocked(requireAuthOrApiToken).mockResolvedValue(testUser as Parameters<typeof vi.mocked>[0]);
  });

  afterEach(async () => {
    await db.attachment.deleteMany({
      where: { message: { featureId: testFeature.id } },
    });
    await db.chatMessage.deleteMany({ where: { featureId: testFeature.id } });
    await db.phase.deleteMany({ where: { featureId: testFeature.id } });
    await db.feature.delete({ where: { id: testFeature.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.delete({ where: { id: testWorkspace.id } });
    await db.user.delete({ where: { id: testUser.id } });
  });

  function makeParams(featureId: string) {
    return { params: Promise.resolve({ featureId }) };
  }

  it("persists Attachment records linked to the ChatMessage when attachments are provided", async () => {
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue("https://s3.example.com/signed-url");

    const attachments = [
      { path: "uploads/ws/swarm/feat/image.png", filename: "image.png", mimeType: "image/png", size: 204800 },
      { path: "uploads/ws/swarm/feat/photo.jpg", filename: "photo.jpg", mimeType: "image/jpeg", size: 102400 },
    ];

    const request = createPostRequest(
      `http://localhost:3000/api/features/${testFeature.id}/chat`,
      { message: "Here are the screenshots", attachments },
    );

    const response = await POST(request, makeParams(testFeature.id));

    expect(response.status).toBe(201);

    // Verify DB records
    const savedAttachments = await db.attachment.findMany({
      where: { message: { featureId: testFeature.id } },
    });

    expect(savedAttachments).toHaveLength(2);
    expect(savedAttachments.map((a) => a.filename).sort()).toEqual(["image.png", "photo.jpg"]);
    expect(savedAttachments.map((a) => a.mimeType).sort()).toEqual(["image/jpeg", "image/png"]);
  });

  it("returns attachment objects with presigned download URLs in the response", async () => {
    const signedUrl = "https://s3.example.com/signed-download-url";
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(signedUrl);

    const attachments = [
      { path: "uploads/ws/swarm/feat/screenshot.webp", filename: "screenshot.webp", mimeType: "image/webp", size: 512000 },
    ];

    const request = createPostRequest(
      `http://localhost:3000/api/features/${testFeature.id}/chat`,
      { message: "Check this out", attachments },
    );

    const response = await POST(request, makeParams(testFeature.id));

    expect(response.status).toBe(201);
    const data = await response.json();

    expect(data.message.attachments).toHaveLength(1);
    expect(data.message.attachments[0].filename).toBe("screenshot.webp");
    expect(data.message.attachments[0].url).toBe(signedUrl);
    expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/ws/swarm/feat/screenshot.webp",
    );
  });

  it("creates a message with no attachments when attachments array is omitted", async () => {
    const request = createPostRequest(
      `http://localhost:3000/api/features/${testFeature.id}/chat`,
      { message: "Just text, no files" },
    );

    const response = await POST(request, makeParams(testFeature.id));

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.message.attachments).toHaveLength(0);
    expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("creates a message with no attachments when attachments array is empty", async () => {
    const request = createPostRequest(
      `http://localhost:3000/api/features/${testFeature.id}/chat`,
      { message: "Empty attachments array", attachments: [] },
    );

    const response = await POST(request, makeParams(testFeature.id));

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.message.attachments).toHaveLength(0);
    expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("links attachments to the correct ChatMessage", async () => {
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue("https://s3.example.com/url");

    const attachments = [
      { path: "uploads/ws/swarm/feat/file.gif", filename: "file.gif", mimeType: "image/gif", size: 65536 },
    ];

    const request = createPostRequest(
      `http://localhost:3000/api/features/${testFeature.id}/chat`,
      { message: "With attachment", attachments },
    );

    const response = await POST(request, makeParams(testFeature.id));
    expect(response.status).toBe(201);

    const data = await response.json();
    const messageId = data.message.id;

    const savedMessage = await db.chatMessage.findUnique({
      where: { id: messageId },
      include: { attachments: true },
    });

    expect(savedMessage).not.toBeNull();
    expect(savedMessage!.attachments).toHaveLength(1);
    expect(savedMessage!.attachments[0].filename).toBe("file.gif");
    expect(savedMessage!.role).toBe(ChatRole.USER);
    expect(savedMessage!.status).toBe(ChatStatus.SENT);
  });
});
