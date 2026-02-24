import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET, POST } from "@/app/api/whiteboards/[whiteboardId]/messages/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createTestFeature } from "@/__tests__/support/factories/feature.factory";
import {
  createTestWhiteboardMessage,
  createTestWhiteboardMessageThread,
} from "@/__tests__/support/factories/whiteboard-message.factory";
import * as stakworkRunService from "@/services/stakwork-run";

vi.mock("@/services/stakwork-run", async () => {
  const actual = await vi.importActual("@/services/stakwork-run");
  return {
    ...actual,
    createDiagramStakworkRun: vi.fn(),
  };
});

describe("GET /api/whiteboards/[whiteboardId]/messages", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof createTestFeature>>;
  let testWhiteboard: Awaited<ReturnType<typeof db.whiteboard.create>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testFeature = await createTestFeature({
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      updatedById: testUser.id,
      architecture: "Test architecture for diagram generation",
    });

    testWhiteboard = await db.whiteboard.create({
      data: {
        name: "Test Whiteboard",
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        elements: [],
        appState: {},
        files: {},
      },
    });

    otherUser = await createTestUser();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = new Request(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectUnauthorized(response);
    });

    it("returns 403 for non-workspace members", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        otherUser
      );

      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectForbidden(response);
    });
  });

  describe("Message Retrieval", () => {
    it("returns empty array when no messages exist", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser
      );

      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      const result = await expectSuccess(response);
      expect(result.data).toEqual([]);
    });

    it("returns messages ordered by createdAt ascending", async () => {
      // Create messages with slight delay to ensure different timestamps
      const message1 = await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "USER",
        content: "First message",
        userId: testUser.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const message2 = await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "ASSISTANT",
        content: "Second message",
        userId: null,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const message3 = await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "USER",
        content: "Third message",
        userId: testUser.id,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser
      );

      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      const result = await expectSuccess(response);
      expect(result.data).toHaveLength(3);
      expect(result.data[0].id).toBe(message1.id);
      expect(result.data[1].id).toBe(message2.id);
      expect(result.data[2].id).toBe(message3.id);
      expect(result.data[0].content).toBe("First message");
      expect(result.data[1].content).toBe("Second message");
      expect(result.data[2].content).toBe("Third message");
    });

    it("returns only messages for the specified whiteboard", async () => {
      // Create another whiteboard with messages
      const otherWhiteboard = await db.whiteboard.create({
        data: {
          name: "Other Whiteboard",
          workspaceId: testWorkspace.id,
          elements: [],
          appState: {},
          files: {},
        },
      });

      await createTestWhiteboardMessage({
        whiteboardId: otherWhiteboard.id,
        role: "USER",
        content: "Other whiteboard message",
        userId: testUser.id,
      });

      const message = await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "USER",
        content: "Test whiteboard message",
        userId: testUser.id,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser
      );

      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      const result = await expectSuccess(response);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(message.id);
      expect(result.data[0].content).toBe("Test whiteboard message");
    });
  });
});

describe("POST /api/whiteboards/[whiteboardId]/messages", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof createTestFeature>>;
  let testWhiteboard: Awaited<ReturnType<typeof db.whiteboard.create>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testFeature = await createTestFeature({
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      updatedById: testUser.id,
      architecture: "Test architecture for diagram generation",
    });

    testWhiteboard = await db.whiteboard.create({
      data: {
        name: "Test Whiteboard",
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        elements: [],
        appState: {},
        files: {},
      },
    });

    otherUser = await createTestUser();

    // Mock createDiagramStakworkRun to return a mock run
    vi.mocked(stakworkRunService.createDiagramStakworkRun).mockResolvedValue({
      id: "mock-run-id",
      type: "DIAGRAM_GENERATION",
      status: "PENDING",
      featureId: testFeature.id,
      userId: testUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = new Request(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Test message" }),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectUnauthorized(response);
    });

    it("returns 403 for non-workspace members", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        otherUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectForbidden(response);
    });
  });

  describe("Validation", () => {
    it("returns 400 when whiteboard has no linked feature", async () => {
      const whiteboardNoFeature = await db.whiteboard.create({
        data: {
          name: "No Feature Whiteboard",
          workspaceId: testWorkspace.id,
          featureId: null,
          elements: [],
          appState: {},
          files: {},
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${whiteboardNoFeature.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: whiteboardNoFeature.id }),
      });

      await expectError(
        response,
        "Whiteboard must be linked to a feature",
        400
      );
    });

    it("returns 400 when feature has no architecture", async () => {
      const featureNoArchitecture = await createTestFeature({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        architecture: "",
      });

      const whiteboardNoArchitecture = await db.whiteboard.create({
        data: {
          name: "No Architecture Whiteboard",
          workspaceId: testWorkspace.id,
          featureId: featureNoArchitecture.id,
          elements: [],
          appState: {},
          files: {},
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${whiteboardNoArchitecture.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: whiteboardNoArchitecture.id }),
      });

      await expectError(
        response,
        "Feature must have architecture text",
        400
      );
    });

    it("returns 400 when content is missing", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "Content is required", 400);
    });
  });

  describe("Concurrent Generation Guard", () => {
    it("returns 409 when a DIAGRAM_GENERATION run is already PENDING", async () => {
      // Create a pending StakworkRun
      await db.stakworkRun.create({
        data: {
          type: "DIAGRAM_GENERATION",
          status: "PENDING",
          featureId: testFeature.id,
          workspaceId: testWorkspace.id,
          webhookUrl: "http://localhost:3000/api/webhook/stakwork/response",
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toBe("Diagram generation in progress");
      expect(result.generating).toBe(true);
    });

    it("returns 409 when a DIAGRAM_GENERATION run is already IN_PROGRESS", async () => {
      // Create an in-progress StakworkRun
      await db.stakworkRun.create({
        data: {
          type: "DIAGRAM_GENERATION",
          status: "IN_PROGRESS",
          featureId: testFeature.id,
          workspaceId: testWorkspace.id,
          webhookUrl: "http://localhost:3000/api/webhook/stakwork/response",
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toBe("Diagram generation in progress");
      expect(result.generating).toBe(true);
    });

    it("allows POST when previous DIAGRAM_GENERATION run is COMPLETED", async () => {
      // Create a completed StakworkRun
      await db.stakworkRun.create({
        data: {
          type: "DIAGRAM_GENERATION",
          status: "COMPLETED",
          featureId: testFeature.id,
          workspaceId: testWorkspace.id,
          webhookUrl: "http://localhost:3000/api/webhook/stakwork/response",
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);
      const result = await response.json();
      expect(result.success).toBe(true);
    });
  });

  describe("Message Creation and Diagram Generation", () => {
    it("persists USER message and calls createDiagramStakworkRun on success", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Generate a diagram for user authentication flow" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.data.message).toBeDefined();
      expect(result.data.message.role).toBe("USER");
      expect(result.data.message.content).toBe(
        "Generate a diagram for user authentication flow"
      );
      expect(result.data.message.status).toBe("SENT");
      expect(result.data.message.userId).toBe(testUser.id);
      expect(result.data.message.whiteboardId).toBe(testWhiteboard.id);
      expect(result.data.runId).toBe("mock-run-id");

      // Verify message was persisted in DB
      const persistedMessage = await db.whiteboardMessage.findUnique({
        where: { id: result.data.message.id },
      });
      expect(persistedMessage).toBeDefined();
      expect(persistedMessage?.content).toBe(
        "Generate a diagram for user authentication flow"
      );

      // Verify createDiagramStakworkRun was called with correct params
      expect(stakworkRunService.createDiagramStakworkRun).toHaveBeenCalledWith({
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        architectureText: "Test architecture for diagram generation",
        layout: "layered",
        userId: testUser.id,
      });
    });

    it("passes optional layout parameter to createDiagramStakworkRun", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message", layout: "force" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);

      expect(stakworkRunService.createDiagramStakworkRun).toHaveBeenCalledWith({
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        architectureText: "Test architecture for diagram generation",
        layout: "force",
        userId: testUser.id,
      });
    });

    it("returns 202 status for accepted async processing", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when createDiagramStakworkRun fails", async () => {
      vi.mocked(stakworkRunService.createDiagramStakworkRun).mockRejectedValue(
        new Error("Stakwork service unavailable")
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages`,
        testUser,
        { content: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to create message");
    });
  });
});
