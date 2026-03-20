import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/features/[featureId]/route";
import { pusherServer, PUSHER_EVENTS } from "@/lib/pusher";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Mock dependencies
vi.mock("@/lib/auth/api-token");
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: {
    FEATURE_TITLE_UPDATE: "feature-title-update",
  },
}));

const mockedPusherServer = vi.mocked(pusherServer);
const mockedRequireAuthOrApiToken = vi.mocked(requireAuthOrApiToken);

function createPatchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/features/feature-123", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const featureParams = Promise.resolve({ featureId: "feature-123" });

describe("PATCH /api/features/[featureId] - Pusher broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful auth
    mockedRequireAuthOrApiToken.mockResolvedValue({
      userId: "user-123",
      workspaceId: "workspace-1",
    } as any);

    // Mock feature lookup with workspace structure for validateFeatureAccess
    dbMock.features.findUnique.mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      title: "Old Title",
      brief: null,
      requirements: null,
      architecture: null,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      planUpdatedAt: null,
      createdById: "user-123",
      deleted: false,
      workspace: {
        id: "workspace-1",
        ownerId: "user-123",
        deleted: false,
        members: [
          {
            role: "OWNER",
          },
        ],
      },
    } as any);

    // Mock successful update - must include phases array for updateFeature transform
    dbMock.features.update.mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      title: "New Title",
      brief: null,
      requirements: null,
      architecture: null,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: "user-123",
      phases: [],
      tasks: [],
      userStories: [],
      workspace: {
        id: "workspace-1",
        name: "Test Workspace",
        slug: "test-workspace",
      },
    } as any);

    // Mock pusher trigger to resolve successfully by default
    mockedPusherServer.trigger.mockResolvedValue({} as any);
  });

  it("should trigger Pusher broadcast when title is updated", async () => {
    const request = createPatchRequest({ title: "New Title" });
    const response = await PATCH(request, { params: featureParams });

    if (response.status !== 200) {
      const errorData = await response.json();
      console.log("Error response:", errorData);
    }

    expect(response.status).toBe(200);

    expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
      "feature-feature-123",
      PUSHER_EVENTS.FEATURE_TITLE_UPDATE,
      {
        featureId: "feature-123",
        newTitle: "New Title",
      },
    );
  });

  it("should trim title before broadcasting", async () => {
    const request = createPatchRequest({ title: "  Trimmed Title  " });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);

    expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
      "feature-feature-123",
      PUSHER_EVENTS.FEATURE_TITLE_UPDATE,
      {
        featureId: "feature-123",
        newTitle: "Trimmed Title",
      },
    );
  });

  it("should NOT trigger Pusher when title is not provided", async () => {
    const request = createPatchRequest({ status: "IN_PROGRESS" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(mockedPusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should NOT trigger Pusher when title is empty string", async () => {
    const request = createPatchRequest({ title: "" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(mockedPusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should NOT trigger Pusher when title is only whitespace", async () => {
    const request = createPatchRequest({ title: "   " });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(mockedPusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should return 200 even when Pusher trigger fails", async () => {
    mockedPusherServer.trigger.mockRejectedValue(new Error("Pusher error"));

    const request = createPatchRequest({ title: "New Title" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(mockedPusherServer.trigger).toHaveBeenCalled();
  });

  it("should still update feature when Pusher trigger fails", async () => {
    mockedPusherServer.trigger.mockRejectedValue(new Error("Pusher error"));

    const request = createPatchRequest({ title: "New Title" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.title).toBe("New Title");

    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          title: "New Title",
        }),
      }),
    );
  });

  it("should trigger Pusher when updating title along with other fields", async () => {
    const request = createPatchRequest({
      title: "Updated Title",
      status: "IN_PROGRESS",
      priority: "HIGH",
    });
    
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
      "feature-feature-123",
      PUSHER_EVENTS.FEATURE_TITLE_UPDATE,
      {
        featureId: "feature-123",
        newTitle: "Updated Title",
      },
    );
  });
});

describe("PATCH /api/features/[featureId] - planUpdatedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful auth
    mockedRequireAuthOrApiToken.mockResolvedValue({
      userId: "user-123",
      workspaceId: "workspace-1",
    } as any);

    // Mock feature lookup with workspace structure for validateFeatureAccess
    dbMock.features.findUnique.mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      title: "Old Title",
      brief: null,
      requirements: null,
      architecture: null,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      planUpdatedAt: null,
      createdById: "user-123",
      deleted: false,
      workspace: {
        id: "workspace-1",
        ownerId: "user-123",
        deleted: false,
        members: [
          {
            role: "OWNER",
          },
        ],
      },
    } as any);

    // Mock successful update - must include phases array for updateFeature transform
    dbMock.features.update.mockResolvedValue({
      id: "feature-123",
      workspaceId: "workspace-1",
      title: "New Title",
      brief: null,
      requirements: null,
      architecture: null,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      planUpdatedAt: new Date(),
      createdById: "user-123",
      phases: [],
      tasks: [],
      userStories: [],
      workspace: {
        id: "workspace-1",
        name: "Test Workspace",
        slug: "test-workspace",
      },
    } as any);

    // Mock user lookup for assignee validation (returns null by default, override in specific tests)
    dbMock.users.findFirst.mockResolvedValue(null);
  });

  it("should set planUpdatedAt when updating brief", async () => {
    const request = createPatchRequest({ brief: "Updated brief content" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          brief: "Updated brief content",
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should set planUpdatedAt when updating requirements", async () => {
    const request = createPatchRequest({ requirements: "Updated requirements" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          requirements: "Updated requirements",
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should set planUpdatedAt when updating architecture", async () => {
    const request = createPatchRequest({ architecture: "Updated architecture" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          architecture: "Updated architecture",
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should set planUpdatedAt when updating multiple plan fields", async () => {
    const request = createPatchRequest({
      brief: "New brief",
      requirements: "New requirements",
    });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          brief: "New brief",
          requirements: "New requirements",
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should NOT set planUpdatedAt when updating only title", async () => {
    const request = createPatchRequest({ title: "New Title" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.not.objectContaining({
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should NOT set planUpdatedAt when updating only status", async () => {
    const request = createPatchRequest({ status: "IN_PROGRESS" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.not.objectContaining({
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should NOT set planUpdatedAt when updating only priority", async () => {
    const request = createPatchRequest({ priority: "HIGH" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.not.objectContaining({
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should NOT set planUpdatedAt when updating only assigneeId", async () => {
    // Mock the assignee user lookup that updateFeature performs
    dbMock.users.findFirst.mockResolvedValue({
      id: "user-456",
      name: "Assignee User",
      email: "assignee@example.com",
    } as any);

    const request = createPatchRequest({ assigneeId: "user-456" });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.not.objectContaining({
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("should set planUpdatedAt when updating plan field along with non-plan fields", async () => {
    const request = createPatchRequest({
      brief: "Updated brief",
      status: "IN_PROGRESS",
      priority: "HIGH",
    });
    const response = await PATCH(request, { params: featureParams });

    expect(response.status).toBe(200);
    expect(dbMock.features.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "feature-123" },
        data: expect.objectContaining({
          brief: "Updated brief",
          planUpdatedAt: expect.any(Date),
        }),
      }),
    );
  });
});
