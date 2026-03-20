import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/whiteboards/[whiteboardId]/messages/clarify/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedPostRequest,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createTestFeature } from "@/__tests__/support/factories/feature.factory";
import { createTestWhiteboardMessage } from "@/__tests__/support/factories/whiteboard-message.factory";
import * as stakworkRunService from "@/services/stakwork-run";

vi.mock("@/services/stakwork-run", async () => {
  const actual = await vi.importActual("@/services/stakwork-run");
  return {
    ...actual,
    createDiagramStakworkRun: vi.fn(),
  };
});

describe("POST /api/whiteboards/[whiteboardId]/messages/clarify", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof createTestFeature>>;
  let testWhiteboard: Awaited<ReturnType<typeof db.whiteboards.create>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;

  const mockClarifyingQuestions = {
    tool_use: "ask_clarifying_questions",
    content: [
      { question: "What services should be included?", type: "text" },
      {
        question: "What direction should the layout go?",
        type: "single_choice",
        options: ["Top-down", "Left-right"],
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({owner_id: testUser.id });
    testFeature = await createTestFeature({workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
      architecture: "Test architecture for diagram generation",
    });

    testWhiteboard = await db.whiteboards.create({
      data: {
        name: "Test Whiteboard",workspace_id: testWorkspace.id,feature_id: testFeature.id,
        elements: [],
        appState: {},
        files: {},
      },
    });

    otherUser = await createTestUser();

    vi.mocked(stakworkRunService.createDiagramStakworkRun).mockResolvedValue({
      id: "mock-run-id",
      type: "DIAGRAM_GENERATION",
      status: "PENDING",feature_id: testFeature.id,user_id: testUser.id,created_at: new Date(),updated_at: new Date(),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = new Request(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: "Some answers" }),
        }
      );

      const response = await POST(request as any, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectUnauthorized(response);
    });

    it("returns 403 for non-workspace members", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        otherUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectForbidden(response);
    });
  });

  describe("Validation", () => {
    it("returns 400 when answers field is missing", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "Answers are required", 400);
    });

    it("returns 400 when answers is not a string", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: 123 }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "Answers are required", 400);
    });
  });

  describe("Missing clarifying questions (400)", () => {
    it("returns 400 when no ASSISTANT message exists", async () => {
      // No messages at all
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Top-down layout with API gateway" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "No pending clarifying questions found", 400);
    });

    it("returns 400 when last ASSISTANT message has no metadata tool_use", async () => {
      // ASSISTANT message without clarifying questions metadata
      await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "ASSISTANT",
        content: "Here is your diagram.",user_id: null,
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "No pending clarifying questions found", 400);
    });

    it("returns 400 when last ASSISTANT message has different tool_use", async () => {
      await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "Processing...",
          status: "SENT",
          metadata: { tool_use: "some_other_tool" },
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectError(response, "No pending clarifying questions found", 400);
    });
  });

  describe("Concurrent generation guard (409)", () => {
    it("returns 409 when a DIAGRAM_GENERATION run is PENDING for the feature", async () => {
      // Seed clarifying questions so we pass the 400 check
      await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "I have a few questions.",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      await db.stakwork_runs.create({
        data: {
          type: "DIAGRAM_GENERATION",
          status: "PENDING",feature_id: testFeature.id,workspace_id: testWorkspace.id,webhook_url: "http://localhost:3000/api/webhook/stakwork/response",
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Top-down, with 3 services" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toBe("Diagram generation in progress");
      expect(result.generating).toBe(true);
    });

    it("returns 409 when a DIAGRAM_GENERATION run is IN_PROGRESS for the whiteboard URL", async () => {
      const standaloneWhiteboard = await db.whiteboards.create({
        data: {
          name: "Standalone",workspace_id: testWorkspace.id,feature_id: null,
          elements: [],
          appState: {},
          files: {},
        },
      });

      await db.whiteboard_messages.create({
        data: {
          whiteboardId: standaloneWhiteboard.id,
          role: "ASSISTANT",
          content: "I have a few questions.",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      await db.stakwork_runs.create({
        data: {
          type: "DIAGRAM_GENERATION",
          status: "IN_PROGRESS",feature_id: null,workspace_id: testWorkspace.id,webhook_url: `http://localhost:3000/api/webhook/stakwork/response?whiteboard_id=${standaloneWhiteboard.id}`,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${standaloneWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: standaloneWhiteboard.id }),
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toBe("Diagram generation in progress");
    });
  });

  describe("Success path (202)", () => {
    it("persists USER message, triggers diagram run, returns 202 for feature-linked whiteboard", async () => {
      // Seed: USER message (original prompt) then ASSISTANT with clarifying questions
      const originalUserMessage = await createTestWhiteboardMessage({
        whiteboardId: testWhiteboard.id,
        role: "USER",
        content: "Draw the auth flow",user_id: testUser.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const clarifyMessage = await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "I have a few questions before generating the diagram.",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      const answers =
        "Q: What services should be included?\nA: API gateway, Auth service, DB\n\nQ: What direction should the layout go?\nA: Top-down";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.data.message).toBeDefined();
      expect(result.data.message.role).toBe("USER");
      expect(result.data.message.content).toBe(answers);
      expect(result.data.message.userId).toBe(testUser.id);
      expect(result.data.runId).toBe("mock-run-id");

      // Verify message was persisted
      const persisted = await db.whiteboard_messages.findUnique({
        where: { id: result.data.message.id },
      });
      expect(persisted).toBeDefined();
      expect(persisted?.content).toBe(answers);

      // Verify createDiagramStakworkRun was called with enriched text
      expect(stakworkRunService.createDiagramStakworkRun).toHaveBeenCalledWith(
        expect.objectContaining({workspace_id: testWorkspace.id,feature_id: testFeature.id,
          whiteboardId: testWhiteboard.id,
          architectureText: expect.stringContaining("Draw the auth flow"),
          layout: "layered",user_id: testUser.id,
        })
      );

      // architectureText should contain original prompt + answers + feature architecture
      const callArgs = vi.mocked(
        stakworkRunService.createDiagramStakworkRun
      ).mock.calls[0][0];
      expect(callArgs.architectureText).toContain("Draw the auth flow");
      expect(callArgs.architectureText).toContain(
        "Answers to clarifying questions:"
      );
      expect(callArgs.architectureText).toContain(answers);
      expect(callArgs.architectureText).toContain(
        "Test architecture for diagram generation"
      );

      // Unused IDs silence the linter
      void originalUserMessage.id;
      void clarifyMessage.id;
    });

    it("uses only answers as enriched prompt when no original USER message exists", async () => {
      // Only the clarifying questions ASSISTANT message, no prior USER message
      await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "I have a few questions.",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      const answers = "Q: What services?\nA: Just a single service";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);

      const callArgs = vi.mocked(
        stakworkRunService.createDiagramStakworkRun
      ).mock.calls[0][0];
      // No original prompt → enrichedPrompt = answers only (then wrapped in architecture)
      expect(callArgs.architectureText).toContain(answers);
      expect(callArgs.architectureText).not.toContain(
        "Answers to clarifying questions:"
      );
    });

    it("works correctly for standalone whiteboard (no featureId)", async () => {
      const standaloneWhiteboard = await db.whiteboards.create({
        data: {
          name: "Standalone",workspace_id: testWorkspace.id,feature_id: null,
          elements: [],
          appState: {},
          files: {},
        },
      });

      await createTestWhiteboardMessage({
        whiteboardId: standaloneWhiteboard.id,
        role: "USER",
        content: "Draw the system",user_id: testUser.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      await db.whiteboard_messages.create({
        data: {
          whiteboardId: standaloneWhiteboard.id,
          role: "ASSISTANT",
          content: "I have a few questions.",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      const answers = "Q: What services should be included?\nA: Web, API, DB";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${standaloneWhiteboard.id}/messages/clarify`,
        testUser,
        { answers }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: standaloneWhiteboard.id }),
      });

      expect(response.status).toBe(202);
      const result = await response.json();
      expect(result.success).toBe(true);

      const callArgs = vi.mocked(
        stakworkRunService.createDiagramStakworkRun
      ).mock.calls[0][0];
      expect(callArgs.workspaceId).toBe(testWorkspace.id);
      expect(callArgs.featureId).toBeUndefined();
      expect(callArgs.architectureText).toContain("Draw the system");
      expect(callArgs.architectureText).toContain(
        "Answers to clarifying questions:"
      );
    });

    it("passes layout parameter from request body", async () => {
      await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "Questions...",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Some answers", layout: "force" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(202);

      const callArgs = vi.mocked(
        stakworkRunService.createDiagramStakworkRun
      ).mock.calls[0][0];
      expect(callArgs.layout).toBe("force");
    });
  });

  describe("Error handling", () => {
    it("returns 404 for non-existent whiteboard", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/nonexistent-id/messages/clarify`,
        testUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: "nonexistent-id" }),
      });

      expect(response.status).toBe(404);
    });

    it("returns 500 when createDiagramStakworkRun throws", async () => {
      await db.whiteboard_messages.create({
        data: {
          whiteboardId: testWhiteboard.id,
          role: "ASSISTANT",
          content: "Questions...",
          status: "SENT",
          metadata: mockClarifyingQuestions,
        },
      });

      vi.mocked(stakworkRunService.createDiagramStakworkRun).mockRejectedValue(
        new Error("Stakwork unavailable")
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}/messages/clarify`,
        testUser,
        { answers: "Some answers" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to submit answers");
    });
  });
});
