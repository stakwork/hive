import { describe, test, expect, beforeEach, vi } from "vitest";
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

// Import after mocks are set up
import { POST } from "@/app/api/features/create-feature/route";
import { extractFeatureFromTranscript } from "@/lib/ai/extract-feature";

const mockExtractFeatureFromTranscript = vi.mocked(extractFeatureFromTranscript);

describe("POST /api/features/create-feature - Feature Extraction Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: returns extracted title + brief
    mockExtractFeatureFromTranscript.mockResolvedValue({
      title: "Extracted Feature Title",
      brief: "This is the extracted brief from the transcript",
      requirements: "These are the extracted requirements",
    });
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "User wants to build a new feature",
          workspaceSlug: "test-workspace",
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
          workspaceSlug: "nonexistent-workspace",
        },
        user
      );

      const response = await POST(request);

      await expectError(response, "Workspace not found", 404);
    });
  });

  describe("Extraction — String Input", () => {
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

    test("returns { title, description } from a valid string transcript", async () => {
      mockExtractFeatureFromTranscript.mockResolvedValueOnce({
        title: "Auth System",
        brief: "OAuth-based login with social providers",
        requirements: "- Google OAuth\n- GitHub OAuth",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        {
          transcript: "I want to build a user authentication system with OAuth support",
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data).toMatchObject({
        title: "Auth System",
        description: "OAuth-based login with social providers",
      });
      expect(data).not.toHaveProperty("featureId");
      expect(data).not.toHaveProperty("run");
    });

    test("calls extractFeatureFromTranscript with transcript and workspaceSlug", async () => {
      const transcript = "Build a reporting dashboard";

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript, workspaceSlug: workspace.slug },
        user
      );

      await POST(request);

      expect(mockExtractFeatureFromTranscript).toHaveBeenCalledWith(
        transcript,
        workspace.slug
      );
    });
  });

  describe("Extraction — ModelMessage Array Input", () => {
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

    test("returns { title, description } from a valid message array transcript", async () => {
      mockExtractFeatureFromTranscript.mockResolvedValueOnce({
        title: "Dashboard Feature",
        brief: "Show sales data and user activity metrics",
        requirements: "- Sales chart\n- User activity heatmap",
      });

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

      const data = await expectSuccess(response, 200);
      expect(data).toMatchObject({
        title: "Dashboard Feature",
        description: "Show sales data and user activity metrics",
      });
      expect(mockExtractFeatureFromTranscript).toHaveBeenCalledWith(
        messages,
        workspace.slug
      );
    });

    test("accepts multi-content message format", async () => {
      const messages = [
        {
          role: "user",
          content: [{ type: "text", text: "Build a reporting system" }],
        },
      ];

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: messages, workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      await expectSuccess(response, 200);
      expect(mockExtractFeatureFromTranscript).toHaveBeenCalled();
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

    test("returns exactly { title, description } — no extra fields", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "Create feature", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(Object.keys(data).sort()).toEqual(["description", "title"]);
    });

    test("returns 200 status code on success", async () => {
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "Feature", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("description maps to extractedFeature.brief", async () => {
      mockExtractFeatureFromTranscript.mockResolvedValueOnce({
        title: "Some Title",
        brief: "The seed message comes from brief",
        requirements: "Some requirements",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "Build it", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.description).toBe("The seed message comes from brief");
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

    test("returns 500 when AI extraction throws", async () => {
      mockExtractFeatureFromTranscript.mockRejectedValueOnce(
        new Error("AI service unavailable")
      );

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/create-feature",
        { transcript: "Build a feature", workspaceSlug: workspace.slug },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
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
});
