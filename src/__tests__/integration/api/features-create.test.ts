import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

// Mock AI feature extraction
vi.mock("@/lib/ai/extract-feature", () => ({
  extractFeatureFromTranscript: vi.fn(),
}));

// Mock Stakwork service for deep research integration
vi.mock("@/services/stakwork-run", () => ({
  createStakworkRun: vi.fn(),
}));

// Import after mocks are set up
import { POST } from "@/app/api/features/create-feature/route";
import { extractFeatureFromTranscript } from "@/lib/ai/extract-feature";
import { createStakworkRun } from "@/services/stakwork-run";

const mockExtractFeatureFromTranscript = vi.mocked(extractFeatureFromTranscript);
const mockCreateStakworkRun = vi.mocked(createStakworkRun);

describe("POST /api/features/create-feature - Voice Transcript Feature Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation for AI extraction
    mockExtractFeatureFromTranscript.mockResolvedValue({
      title: "Extracted Feature Title",
      brief: "This is the extracted brief from the transcript",
      requirements: "These are the extracted requirements from the conversation",
    });
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "User wants to build a new feature",
          workspaceSlug: "test-workspace" 
        }
      );

      const response = await POST(request);

      await expectUnauthorized(response);
    });
  });

  describe("Input Validation", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("returns 400 when transcript is missing", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("returns 400 when workspaceSlug is missing", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "Build a new dashboard" },
        user
      );

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("returns 400 when transcript is empty string", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("returns 400 when transcript is whitespace only", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "   ", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectError(response, "Transcript must be a non-empty", 400);
    });

    test("returns 400 when transcript is empty array", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: [], workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectError(response, "Transcript must be a non-empty", 400);
    });

    test("returns 404 when workspace does not exist", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Create a new feature",
          workspaceSlug: "nonexistent-workspace" 
        },
        user
      );

      const response = await POST(request);

      await expectError(response, "Workspace not found", 404);
    });
  });

  describe("Transcript Processing - String Input", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("processes string transcript and creates feature", async () => {
      const transcript = "I want to build a user authentication system with OAuth support";

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript, workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(mockExtractFeatureFromTranscript).toHaveBeenCalledWith(
        transcript,
        workspace.slug
      );
      expect(data.title).toBe("Extracted Feature Title");
      expect(data.featureId).toBeDefined();
    });

    test("uses AI extracted data for feature creation", async () => {
      mockExtractFeatureFromTranscript.mockResolvedValueOnce({
        title: "Custom Auth System",
        brief: "OAuth-based authentication with social providers",
        requirements: "- Support Google OAuth\\n- Support GitHub OAuth\\n- Session management",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Build OAuth authentication",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 201);

      // Verify the feature was created with AI-extracted data
      const feature = await db.feature.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
      });

      expect(feature).toMatchObject({
        title: "Custom Auth System",
        brief: "OAuth-based authentication with social providers",
        requirements: "- Support Google OAuth\\n- Support GitHub OAuth\\n- Session management",
        status: "PLANNED",
      });
    });
  });

  describe("Transcript Processing - Message Array Input", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("processes ModelMessage array transcript", async () => {
      const messages = [
        { role: "user", content: "I need a dashboard feature" },
        { role: "assistant", content: "What metrics should it show?" },
        { role: "user", content: "Show sales data and user activity" },
      ];

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: messages, workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(mockExtractFeatureFromTranscript).toHaveBeenCalledWith(
        messages,
        workspace.slug
      );
      expect(data.success).toBe(true);
    });

    test("accepts multi-content message format", async () => {
      const messages = [
        { 
          role: "user",
          content: [{ type: "text", text: "Build a reporting system" }]
        },
      ];

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: messages, workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockExtractFeatureFromTranscript).toHaveBeenCalled();
    });
  });

  describe("Feature Status - PLANNED Default", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("sets feature status to PLANNED for voice-created features", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Create a feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 201);

      const feature = await db.feature.findFirst({
        where: { workspaceId: workspace.id },
      });

      expect(feature?.status).toBe("PLANNED");
    });
  });

  describe("Deep Research Integration", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("does not trigger deep research when flag is false", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "Build a feature",
          workspaceSlug: workspace.slug,
          deepResearch: false,
        },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockCreateStakworkRun).not.toHaveBeenCalled();
    });

    test("does not trigger deep research when flag is omitted", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Build a feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockCreateStakworkRun).not.toHaveBeenCalled();
    });

    test("triggers deep research when flag is true", async () => {
      mockCreateStakworkRun.mockResolvedValueOnce({
        id: "run-123",
        type: StakworkRunType.ARCHITECTURE,
        status: "PENDING",
        projectId: "proj-456",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "Build a complex feature",
          workspaceSlug: workspace.slug,
          deepResearch: true,
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      
      expect(mockCreateStakworkRun).toHaveBeenCalledWith(
        expect.objectContaining({
          type: StakworkRunType.ARCHITECTURE,
          featureId: data.featureId,
        }),
        user.id
      );

      expect(data.run).toMatchObject({
        id: "run-123",
        type: StakworkRunType.ARCHITECTURE,
        status: "PENDING",
      });
    });

    test("creates feature even if deep research fails", async () => {
      mockCreateStakworkRun.mockRejectedValueOnce(
        new Error("Stakwork service unavailable")
      );

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "Build a feature",
          workspaceSlug: workspace.slug,
          deepResearch: true,
        },
        user
      );

      const response = await POST(request);

      // Feature creation should succeed
      const data = await expectSuccess(response, 201);
      expect(data.featureId).toBeDefined();
      expect(data.run).toBeUndefined(); // No run data if it failed

      // Verify feature exists in database
      const feature = await db.feature.findUnique({
        where: { id: data.featureId },
      });
      expect(feature).toBeDefined();
    });
  });

  describe("Response Format", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("returns feature ID, workspace ID, and title", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Create feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data).toMatchObject({
        success: true,
        featureId: expect.any(String),
        workspaceId: workspace.id,
        title: "Extracted Feature Title",
      });
    });

    test("includes run data when deep research is triggered", async () => {
      mockCreateStakworkRun.mockResolvedValueOnce({
        id: "run-789",
        type: StakworkRunType.ARCHITECTURE,
        status: "PENDING",
        projectId: "proj-123",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "Build feature",
          workspaceSlug: workspace.slug,
          deepResearch: true,
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.run).toMatchObject({
        id: "run-789",
        type: StakworkRunType.ARCHITECTURE,
        status: "PENDING",
        projectId: "proj-123",
      });
    });

    test("returns 201 status code on success", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Error Handling", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("handles AI extraction failure", async () => {
      mockExtractFeatureFromTranscript.mockRejectedValueOnce(
        new Error("Failed to extract feature from transcript")
      );

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Create feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      await expectError(response, "Failed to extract feature from transcript", 500);
    });

    test("handles malformed JSON in request body", async () => {
      const request = new Request(
        "http://localhost:3000/api/features/create-feature",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `authjs.session-token=mock-session-${user.id}`,
          },
          body: "{ invalid json",
        }
      );

      const response = await POST(request);

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Database Persistence", () => {
    let user: any;
    let workspace: any;

    beforeEach(async () => {
      user = await createTestUser();
      workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
    });

    test("persists feature to database with AI-extracted data", async () => {
      mockExtractFeatureFromTranscript.mockResolvedValueOnce({
        title: "Persisted Feature Title",
        brief: "Persisted brief",
        requirements: "Persisted requirements",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Build feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);

      const dbFeature = await db.feature.findUnique({
        where: { id: data.featureId },
      });

      expect(dbFeature).toMatchObject({
        title: "Persisted Feature Title",
        brief: "Persisted brief",
        requirements: "Persisted requirements",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: "PLANNED",
        deleted: false,
      });
    });

    test("sets timestamps correctly", async () => {
      const beforeCreation = new Date();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { 
          transcript: "Feature",
          workspaceSlug: workspace.slug 
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      const afterCreation = new Date();

      const dbFeature = await db.feature.findUnique({
        where: { id: data.featureId },
      });

      expect(dbFeature?.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime()
      );
      expect(dbFeature?.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime()
      );
    });
  });
});
