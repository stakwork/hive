import { describe, test, expect, beforeEach, afterEach, vi, Mock } from "vitest";
import { POST } from "@/app/api/stakwork/create-project/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { type ApiError } from "@/types";
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createPostRequest,
  expectSuccess,
  expectError,
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

const mockCreateProject = vi.fn();

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    createProject: mockCreateProject,
  }),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as Mock;

// Test Data Factories
const TestDataFactory = {
  createValidProjectData: () => ({
    title: "Integration Test Project",
    description: "A project for integration testing",
    budget: 5000,
    skills: ["javascript", "typescript", "react"],
    name: "integration-test-project",
    workflow_id: 456,
    workflow_params: {
      set_var: {
        attributes: {
          vars: {
            environment: "test",
            version: "1.0.0",
          },
        },
      },
    },
  }),

  createMinimalProjectData: () => ({
    title: "Minimal Project",
    description: "Minimal project description",
    budget: 1000,
    skills: ["javascript"],
  }),

  createMockStakworkResponse: (overrides = {}) => ({
    id: "project-789",
    title: "Integration Test Project",
    description: "A project for integration testing",
    budget: 5000,
    skills: ["javascript", "typescript", "react"],
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  createApiError: (overrides: Partial<ApiError> = {}): ApiError => ({
    message: "Test API error",
    status: 500,
    service: "stakwork",
    details: {},
    ...overrides,
  }),
};

// Test Suite
describe("POST /api/stakwork/create-project - Integration Tests", () => {
  let testUserId: string;
  let testWorkspaceId: string;

  beforeEach(async () => {
    // Clear mocks
    vi.clearAllMocks();

    // Create test user
    const user = await createTestUser({
      email: `integration-test-${generateUniqueId()}@example.com`,
      githubUsername: `integration-test-user-${generateUniqueId()}`,
    });
    testUserId = user.id;

    // Create test workspace
    const workspace = await createTestWorkspace({
      name: "Integration Test Workspace",
      slug: generateUniqueSlug("integration-test"),
      ownerId: testUserId,
    });
    testWorkspaceId = workspace.id;

    // Create test swarm with API key
    const testApiKey = `test-api-key-${generateUniqueId()}`;
    await createTestSwarm({
      workspaceId: testWorkspaceId,
      name: `integration-test-swarm-${generateUniqueId()}`,
      swarmApiKey: testApiKey,
    });

    // Setup authenticated session
    mockGetServerSession.mockResolvedValue(
      createAuthenticatedSession({
        id: testUserId,
        email: `integration-test-${testUserId}@example.com`,
      }),
    );
  });

  afterEach(async () => {
    // Cleanup database
    await db.swarm.deleteMany({
      where: { workspaceId: testWorkspaceId },
    });
    await db.workspaceMember.deleteMany({
      where: { userId: testUserId },
    });
    await db.workspace.deleteMany({
      where: { id: testWorkspaceId },
    });
    await db.gitHubAuth.deleteMany({
      where: { userId: testUserId },
    });
    await db.user.deleteMany({
      where: { id: testUserId },
    });
  });

  describe("Service Layer Integration", () => {
    test("should successfully create project through service layer", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      const mockResponse = TestDataFactory.createMockStakworkResponse({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
        skills: projectData.skills,
      });

      mockCreateProject.mockResolvedValue(mockResponse);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      
      expect(data.project).toEqual(mockResponse);
      expect(mockCreateProject).toHaveBeenCalledWith({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
        skills: projectData.skills,
        name: projectData.name,
        workflow_id: projectData.workflow_id,
        workflow_params: projectData.workflow_params,
      });
    });

    test("should handle service layer with minimal required fields", async () => {
      const projectData = TestDataFactory.createMinimalProjectData();
      const mockResponse = TestDataFactory.createMockStakworkResponse({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
        skills: projectData.skills,
      });

      mockCreateProject.mockResolvedValue(mockResponse);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith({
        ...projectData,
        name: undefined,
        workflow_id: undefined,
        workflow_params: undefined,
      });
    });

    test("should pass through complex workflow parameters", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      projectData.workflow_params = {
        set_var: {
          attributes: {
            vars: {
              environment: "production",
              region: "us-east-1",
              config: {
                timeout: 3000,
                retries: 3,
                maxConcurrency: 5,
              },
              features: ["feature-a", "feature-b", "feature-c"],
            },
          },
        },
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse(),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      await POST(request);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_params: projectData.workflow_params,
        }),
      );

      const callArgs = mockCreateProject.mock.calls[0][0];
      expect(callArgs.workflow_params.set_var.attributes.vars.config).toEqual({
        timeout: 3000,
        retries: 3,
        maxConcurrency: 5,
      });
      expect(callArgs.workflow_params.set_var.attributes.vars.features).toEqual(
        ["feature-a", "feature-b", "feature-c"],
      );
    });
  });

  describe("Error Handling Integration", () => {
    test("should handle ApiError from service layer with proper status", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Invalid project configuration",
        status: 400,
        details: {
          field: "budget",
          issue: "Budget must be positive",
        },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectError(response, apiError.message, 400);
      
      expect(data.service).toBe(apiError.service);
      expect(data.details).toEqual(apiError.details);
    });

    test("should handle 404 ApiError from service layer", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Workflow not found",
        status: 404,
        details: { workflow_id: 999 },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectError(response, "Workflow not found", 404);
      
      expect(data.details).toEqual({ workflow_id: 999 });
    });

    test("should handle 503 service unavailable errors", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Stakwork API temporarily unavailable",
        status: 503,
        details: { retry_after: 30 },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectError(response, "Stakwork API temporarily unavailable", 503);
      
      expect(data.details.retry_after).toBe(30);
    });

    test("should handle generic errors without status property", async () => {
      const genericError = new Error("Unexpected error occurred");
      mockCreateProject.mockRejectedValue(genericError);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      await expectError(response, "Failed to create project", 500);
    });

    test("should handle null/undefined errors", async () => {
      mockCreateProject.mockRejectedValue(null);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      await expectError(response, "Failed to create project", 500);
    });

    test("should handle string errors", async () => {
      mockCreateProject.mockRejectedValue("String error message");

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      await expectError(response, "Failed to create project", 500);
    });
  });

  describe("Authentication Integration", () => {
    test("should reject requests without session", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      await expectError(response, "Unauthorized", 401);

      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("should reject requests with session but no user", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      await expectError(response, "Unauthorized", 401);

      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("should accept requests with valid session", async () => {
      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse(),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockCreateProject).toHaveBeenCalled();
    });
  });

  describe("Validation Integration", () => {
    const validationTestCases = [
      {
        name: "missing title",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).title;
          return data;
        },
      },
      {
        name: "missing description",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).description;
          return data;
        },
      },
      {
        name: "missing budget",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).budget;
          return data;
        },
      },
      {
        name: "missing skills",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).skills;
          return data;
        },
      },
      {
        name: "null budget",
        createInvalidData: () => ({
          ...TestDataFactory.createValidProjectData(),
          budget: null,
        }),
      },
      {
        name: "empty title",
        createInvalidData: () => ({
          ...TestDataFactory.createValidProjectData(),
          title: "",
        }),
      },
      {
        name: "empty description",
        createInvalidData: () => ({
          ...TestDataFactory.createValidProjectData(),
          description: "",
        }),
      },
    ];

    test.each(validationTestCases)(
      "should reject request with $name",
      async ({ createInvalidData }) => {
        const request = createPostRequest(
          "/api/stakwork/create-project",
          createInvalidData(),
        );
        const response = await POST(request);

        await expectError(
          response,
          "Missing required fields: title, description, budget, skills",
          400
        );

        expect(mockCreateProject).not.toHaveBeenCalled();
      },
    );
  });

  describe("Edge Cases Integration", () => {
    test("should handle empty skills array", async () => {
      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        skills: [],
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({ skills: [] }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ skills: [] }),
      );
    });

    test("should handle zero budget", async () => {
      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        budget: 0,
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({ budget: 0 }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ budget: 0 }),
      );
    });

    test("should handle special characters in project fields", async () => {
      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        title: "Project: ñáéíóú & símböls! 🚀",
        description: "Description with émojis 💻 and símböls ⚡",
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({
          title: projectData.title,
          description: projectData.description,
        }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          title: projectData.title,
          description: projectData.description,
        }),
      );
    });

    test("should handle very large workflow_params object", async () => {
      const largeVars = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`]),
      );

      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        workflow_params: {
          set_var: {
            attributes: {
              vars: largeVars,
            },
          },
        },
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse(),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      const callArgs = mockCreateProject.mock.calls[0][0];
      expect(callArgs.workflow_params.set_var.attributes.vars).toHaveProperty(
        "key0",
        "value0",
      );
      expect(callArgs.workflow_params.set_var.attributes.vars).toHaveProperty(
        "key99",
        "value99",
      );
      expect(
        Object.keys(callArgs.workflow_params.set_var.attributes.vars),
      ).toHaveLength(100);
    });

    test("should handle very long strings in fields", async () => {
      const longTitle = "A".repeat(500);
      const longDescription = "B".repeat(2000);

      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        title: longTitle,
        description: longDescription,
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({
          title: longTitle,
          description: longDescription,
        }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          title: longTitle,
          description: longDescription,
        }),
      );
    });

    test("should handle large skills array", async () => {
      const largeSkillsArray = Array.from({ length: 50 }, (_, i) => `skill${i}`);

      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        skills: largeSkillsArray,
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({ skills: largeSkillsArray }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: largeSkillsArray,
        }),
      );
    });

    test("should handle negative budget values", async () => {
      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        budget: -1000,
      };

      mockCreateProject.mockResolvedValue(
        TestDataFactory.createMockStakworkResponse({ budget: -1000 }),
      );

      const request = createPostRequest(
        "/api/stakwork/create-project",
        projectData,
      );
      const response = await POST(request);

      expectSuccess(response, 201);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ budget: -1000 }),
      );
    });
  });

  describe("Response Data Integrity", () => {
    test("should return project data exactly as received from service", async () => {
      const mockResponse = {
        id: "project-custom-123",
        title: "Custom Project",
        description: "Custom description",
        budget: 7500,
        skills: ["python", "django"],
        status: "PENDING",
        created_at: "2024-01-15T10:30:00Z",
        updated_at: "2024-01-15T10:30:00Z",
        metadata: {
          created_by: testUserId,
          tags: ["priority", "backend"],
          custom_field: "custom_value",
        },
      };

      mockCreateProject.mockResolvedValue(mockResponse);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      
      expect(data.project).toEqual(mockResponse);
      expect(data.project.metadata).toEqual(mockResponse.metadata);
    });

    test("should preserve nested object structures in response", async () => {
      const mockResponse = TestDataFactory.createMockStakworkResponse({
        workflow: {
          id: 123,
          name: "test-workflow",
          transitions: [
            { from: "start", to: "processing" },
            { from: "processing", to: "complete" },
          ],
          connections: [
            { source: "node1", target: "node2", type: "success" },
            { source: "node2", target: "node3", type: "error" },
          ],
        },
      });

      mockCreateProject.mockResolvedValue(mockResponse);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      
      expect(data.project.workflow.transitions).toHaveLength(2);
      expect(data.project.workflow.connections).toHaveLength(2);
      expect(data.project.workflow.transitions[0]).toEqual({
        from: "start",
        to: "processing",
      });
    });

    test("should handle null/undefined fields in service response", async () => {
      const mockResponse = {
        ...TestDataFactory.createMockStakworkResponse(),
        name: null,
        workflow_id: undefined,
        metadata: null,
      };

      mockCreateProject.mockResolvedValue(mockResponse);

      const request = createPostRequest(
        "/api/stakwork/create-project",
        TestDataFactory.createValidProjectData(),
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      
      expect(data.project.name).toBeNull();
      expect(data.project.metadata).toBeNull();
    });
  });
});