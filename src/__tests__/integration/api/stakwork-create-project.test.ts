import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/stakwork/create-project/route";
import { type ApiError } from "@/types";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock Stakwork service (external API calls)
const mockCreateProject = vi.fn();

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    createProject: mockCreateProject,
  }),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Test Data Factories
const TestDataFactory = {
  createValidProjectData: () => ({
    title: "Integration Test Project",
    description: "A test project for integration testing",
    budget: 5000,
    skills: ["javascript", "typescript", "react"],
    name: "integration-test-project",
    workflow_id: "test-workflow-123",
    workflow_params: {
      set_var: {
        attributes: {
          vars: {
            testKey1: "testValue1",
            testKey2: "testValue2",
          },
        },
      },
    },
  }),

  createMinimalProjectData: () => ({
    title: "Minimal Test Project",
    description: "Minimal project data",
    budget: 1000,
    skills: ["javascript"],
  }),

  createMockProjectResponse: (overrides = {}) => ({
    id: "project-integration-123",
    title: "Integration Test Project",
    description: "A test project",
    budget: 5000,
    skills: ["javascript", "typescript"],
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  createApiError: (overrides: Partial<ApiError> = {}): ApiError => ({
    message: "Test error",
    status: 400,
    service: "stakwork",
    details: {},
    ...overrides,
  }),
};

// Test Helpers
const TestHelpers = {
  expectUnauthorized: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockCreateProject).not.toHaveBeenCalled();
  },

  expectValidationError: async (response: Response) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required fields: title, description, budget, skills");
    expect(mockCreateProject).not.toHaveBeenCalled();
  },

  expectSuccessfulCreation: async (response: Response) => {
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("project");
    expect(mockCreateProject).toHaveBeenCalledOnce();
    return data.project;
  },

  expectApiError: async (response: Response, expectedStatus: number) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(data).toHaveProperty("service");
    expect(data).toHaveProperty("details");
    return data;
  },
};

// Setup test data helper
async function setupTestData() {
  const userEmail = `test-${generateUniqueId()}@example.com`;
  const workspaceSlug = generateUniqueSlug("test-workspace");

  const user = await db.user.create({
    data: {
      email: userEmail,
      name: "Test User",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      name: "Test Workspace",
      slug: workspaceSlug,
      ownerId: user.id,
    },
  });

  await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  return { user, workspace };
}

describe("POST /api/stakwork/create-project - Integration Tests", () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create real database records
    const testData = await setupTestData();
    testUser = testData.user;
    testWorkspace = testData.workspace;
  });

  afterEach(async () => {
    // Clean up database after each test
    await resetDatabase();
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      await TestHelpers.expectUnauthorized(response);
    });

    test("should return 401 when session exists but user is missing", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      await TestHelpers.expectUnauthorized(response);
    });

    test("should proceed with valid authenticated session from real database user", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(getMockedSession()).toHaveBeenCalled();
      expect(mockCreateProject).toHaveBeenCalledOnce();
    });

    test("should validate user exists in database during session check", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createMinimalProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify user actually exists in database
      const dbUser = await db.user.findUnique({
        where: { id: testUser.id },
      });
      expect(dbUser).toBeTruthy();
      expect(dbUser?.email).toBe(testUser.email);
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
    });

    test("should return 400 when title is missing", async () => {
      const invalidData = {
        description: "Test description",
        budget: 1000,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should return 400 when description is missing", async () => {
      const invalidData = {
        title: "Test Project",
        budget: 1000,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should return 400 when budget is undefined", async () => {
      const invalidData = {
        title: "Test Project",
        description: "Test description",
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should return 400 when budget is null", async () => {
      const invalidData = {
        title: "Test Project",
        description: "Test description",
        budget: null,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should return 400 when skills is missing", async () => {
      const invalidData = {
        title: "Test Project",
        description: "Test description",
        budget: 1000,
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should return 400 when title is empty string", async () => {
      const invalidData = {
        title: "",
        description: "Test description",
        budget: 1000,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", invalidData);
      const response = await POST(request);

      await TestHelpers.expectValidationError(response);
    });

    test("should accept request with only required fields", async () => {
      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      const minimalData = TestDataFactory.createMinimalProjectData();
      const request = createPostRequest("/api/stakwork/create-project", minimalData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          title: minimalData.title,
          description: minimalData.description,
          budget: minimalData.budget,
          skills: minimalData.skills,
        })
      );
    });
  });

  describe("Successful Project Creation", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
    });

    test("should successfully create project with all fields", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      const mockProject = TestDataFactory.createMockProjectResponse({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
        skills: projectData.skills,
      });

      mockCreateProject.mockResolvedValue(mockProject);

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      const project = await TestHelpers.expectSuccessfulCreation(response);

      expect(project).toMatchObject({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
      });

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

    test("should pass workflow parameters correctly to service", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      await POST(request);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_params: projectData.workflow_params,
        })
      );
    });

    test("should return 201 status code with project data", async () => {
      const mockProject = TestDataFactory.createMockProjectResponse({
        id: "project-new-123",
        title: "New Project",
      });

      mockCreateProject.mockResolvedValue(mockProject);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.project.id).toBe("project-new-123");
      expect(data.project.title).toBe("New Project");
    });
  });

  describe("ApiError Handling", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
    });

    test("should handle 400 ApiError from service", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Invalid project configuration",
        status: 400,
        details: { field: "budget", issue: "must be positive" },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      const errorData = await TestHelpers.expectApiError(response, 400);
      expect(errorData.error).toBe("Invalid project configuration");
      expect(errorData.service).toBe("stakwork");
      expect(errorData.details).toEqual({ field: "budget", issue: "must be positive" });
    });

    test("should handle 404 ApiError from service", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Workflow not found",
        status: 404,
        details: { workflow_id: "test-workflow-123" },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      const errorData = await TestHelpers.expectApiError(response, 404);
      expect(errorData.error).toBe("Workflow not found");
    });

    test("should handle 500 ApiError from service", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Internal server error",
        status: 500,
        details: { error: "Database connection failed" },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      await TestHelpers.expectApiError(response, 500);
    });

    test("should handle 503 ApiError from service", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Service unavailable",
        status: 503,
        details: { retry_after: 30 },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      const errorData = await TestHelpers.expectApiError(response, 503);
      expect(errorData.details).toEqual({ retry_after: 30 });
    });

    test("should handle generic Error and return 500", async () => {
      mockCreateProject.mockRejectedValue(new Error("Unexpected error"));

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({ error: "Failed to create project" });
    });
  });

  describe("Database Persistence & Relationships", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
    });

    test("should verify workspace exists in database before project creation", async () => {
      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      // Verify workspace exists
      const workspaceExists = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });
      expect(workspaceExists).toBeTruthy();

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should verify user has workspace membership", async () => {
      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      const membership = await db.workspaceMember.findFirst({
        where: {
          userId: testUser.id,
          workspaceId: testWorkspace.id,
        },
      });

      expect(membership).toBeTruthy();
      expect(membership?.role).toBe("OWNER");

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should maintain database consistency after successful project creation", async () => {
      const mockProject = TestDataFactory.createMockProjectResponse();
      mockCreateProject.mockResolvedValue(mockProject);

      const userCountBefore = await db.user.count();
      const workspaceCountBefore = await db.workspace.count();

      const request = createPostRequest("/api/stakwork/create-project",
        TestDataFactory.createValidProjectData()
      );
      await POST(request);

      const userCountAfter = await db.user.count();
      const workspaceCountAfter = await db.workspace.count();

      expect(userCountAfter).toBe(userCountBefore);
      expect(workspaceCountAfter).toBe(workspaceCountBefore);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
    });

    test("should handle zero budget", async () => {
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const projectData = {
        ...TestDataFactory.createMinimalProjectData(),
        budget: 0,
      };

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ budget: 0 })
      );
    });

    test("should handle empty skills array", async () => {
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const projectData = {
        ...TestDataFactory.createMinimalProjectData(),
        skills: [],
      };

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ skills: [] })
      );
    });

    test("should handle special characters in project fields", async () => {
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const projectData = {
        title: "Test Project: ñáéíóú & símböls!",
        description: "Description with émojis 🚀 and special chars",
        budget: 5000,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test Project: ñáéíóú & símböls!",
          description: "Description with émojis 🚀 and special chars",
        })
      );
    });

    test("should handle large workflow_params object", async () => {
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const largeWorkflowParams = {
        set_var: {
          attributes: {
            vars: Object.fromEntries(
              Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`])
            ),
          },
        },
      };

      const projectData = {
        ...TestDataFactory.createValidProjectData(),
        workflow_params: largeWorkflowParams,
      };

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  key0: "value0",
                  key99: "value99",
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should handle very long title and description", async () => {
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProjectResponse());

      const longTitle = "A".repeat(500);
      const longDescription = "B".repeat(2000);

      const projectData = {
        title: longTitle,
        description: longDescription,
        budget: 1000,
        skills: ["javascript"],
      };

      const request = createPostRequest("/api/stakwork/create-project", projectData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          title: longTitle,
          description: longDescription,
        })
      );
    });
  });
});