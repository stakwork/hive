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

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return {
    ...actual,
    // Default: a signed-in member of the feature's workspace.
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
    feature: { findUnique: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn(), findMany: vi.fn() },
    artifact: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/task-workflow", () => ({
  callStakworkAPI: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("@/services/roadmap/orgContextScout", () => ({
  scoutOrgContext: vi.fn().mockResolvedValue(null),
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

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn().mockReturnValue({
    generatePresignedDownloadUrl: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(`https://s3.example.com/presigned/${path}`),
    ),
  }),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://test.stakwork.com",
    STAKWORK_WORKFLOW_ID: "123",
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChatMessage(overrides: Record<string, unknown> = {}) {
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

function makeFeature() {
  return {
    id: "feature-123",
    workspaceId: "workspace-1",
    planUpdatedAt: null,
    updatedAt: new Date(),
    workflowStatus: "PENDING",
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

describe("POST /api/features/[featureId]/chat — attachment handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.feature.findUnique).mockResolvedValue(makeFeature() as any);
    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);
    vi.mocked(db.feature.update).mockResolvedValue({} as any);
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  });

  it("returns 400 when no message and no attachments are provided", async () => {
    const request = createChatRequest({});
    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Message is required");
  });

  it("returns 400 when message is empty string and attachments is empty array", async () => {
    const request = createChatRequest({ message: "", attachments: [] });
    const response = await POST(request, { params: featureParams });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Message is required");
  });

  it("returns 201 when attachments are provided without a message", async () => {
    const attachment = {
      path: "uploads/image.png",
      filename: "image.png",
      mimeType: "image/png",
      size: 1024,
    };
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      makeChatMessage({ message: "", attachments: [{ id: "att-1", ...attachment }] }) as any,
    );

    const request = createChatRequest({ message: "", attachments: [attachment] });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
  });

  it("returns 201 when both message and attachments are provided", async () => {
    const attachment = {
      path: "uploads/image.png",
      filename: "image.png",
      mimeType: "image/png",
      size: 2048,
    };
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      makeChatMessage({
        message: "Check this image",
        attachments: [{ id: "att-1", ...attachment }],
      }) as any,
    );

    const request = createChatRequest({ message: "Check this image", attachments: [attachment] });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const responseData = await response.json();
    expect(responseData.success).toBe(true);
  });

  it("passes attachments to sendFeatureChatMessage which saves them to DB", async () => {
    const attachment = {
      path: "uploads/screenshot.png",
      filename: "screenshot.png",
      mimeType: "image/png",
      size: 4096,
    };
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      makeChatMessage({ message: "See screenshot", attachments: [{ id: "att-1", ...attachment }] }) as any,
    );

    const request = createChatRequest({ message: "See screenshot", attachments: [attachment] });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: {
            create: [
              {
                path: "uploads/screenshot.png",
                filename: "screenshot.png",
                mimeType: "image/png",
                size: 4096,
              },
            ],
          },
        }),
      }),
    );
  });

  it("generates presigned download URLs and forwards them to callStakworkAPI", async () => {
    const attachment = {
      path: "uploads/diagram.png",
      filename: "diagram.png",
      mimeType: "image/png",
      size: 8192,
    };
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      makeChatMessage({ message: "Here's the diagram", attachments: [{ id: "att-1", ...attachment }] }) as any,
    );

    const request = createChatRequest({
      message: "Here's the diagram",
      attachments: [attachment],
    });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const callArg = vi.mocked(callStakworkAPI).mock.calls[0][0];
    expect(callArg.attachments).toEqual(["https://s3.example.com/presigned/uploads/diagram.png"]);
  });

  it("forwards multiple presigned URLs when multiple attachments are uploaded", async () => {
    const attachments = [
      { path: "uploads/img1.png", filename: "img1.png", mimeType: "image/png", size: 1000 },
      { path: "uploads/img2.jpg", filename: "img2.jpg", mimeType: "image/jpeg", size: 2000 },
    ];
    vi.mocked(db.chatMessage.create).mockResolvedValue(
      makeChatMessage({
        message: "Two images",
        attachments: attachments.map((a, i) => ({ id: `att-${i}`, ...a })),
      }) as any,
    );

    const request = createChatRequest({ message: "Two images", attachments });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const callArg = vi.mocked(callStakworkAPI).mock.calls[0][0];
    expect(callArg.attachments).toEqual([
      "https://s3.example.com/presigned/uploads/img1.png",
      "https://s3.example.com/presigned/uploads/img2.jpg",
    ]);
  });

  it("passes empty attachments array to callStakworkAPI when no attachments sent", async () => {
    vi.mocked(db.chatMessage.create).mockResolvedValue(makeChatMessage() as any);

    const request = createChatRequest({ message: "Text only message" });
    const response = await POST(request, { params: featureParams });

    expect(response.status).toBe(201);
    const callArg = vi.mocked(callStakworkAPI).mock.calls[0][0];
    expect(callArg.attachments).toEqual([]);
  });
});
