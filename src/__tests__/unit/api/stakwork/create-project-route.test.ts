import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stakwork/create-project/route";
import { auth } from "@/auth";
import { type ApiError } from "@/types";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  auth: vi.fn(),
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

const mockGetServerSession = auth as Mock;

// Test Data Factories
const TestDataFactory = {
  createValidProjectData: () => ({
    title: "Test Project",
    description: "A test project description",
    budget: 5000,
    skills: ["javascript", "typescript", "react"],
    name: "test-project",
    workflow_id: 123,
    workflow_params: {
      set_var: {
        attributes: {
          vars: {
            key1: "value1",
            key2: "value2",
          },
        },
      },
    },
  }),

  createMinimalProjectData: () => ({
    title: "Test Project",
    description: "A test project",
    budget: 1000,
    skills: ["javascript"],
  }),

  createValidUser: () => ({
    id: "user-123",
    email: "test@example.com",
  }),

  createValidSession: () => ({
    user: TestDataFactory.createValidUser(),
  }),

  createMockProject: (overrides = {}) => ({
    id: "project-123",
    title: "Test Project",
    description: "A test project",
    budget: 1000,
    skills: ["javascript"],
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
  createMockRequest: (body: object) => {
    return new NextRequest("http://localhost:3000/api/stakwork/create-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  setupAuthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(TestDataFactory.createValidSession());
  },

  setupUnauthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(null);
  },

  setupSessionWithoutUser: () => {
    mockGetServerSession.mockResolvedValue({ user: null });
  },

  expectAuthenticationError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockCreateProject).not.toHaveBeenCalled();
  },

  expectValidationError: async (response: Response, expectedMessage: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe(expectedMessage);
    expect(mockCreateProject).not.toHaveBeenCalled();
  },

  expectSuccessfulResponse: async (response: Response, expectedProject: any) => {
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toEqual({ project: expectedProject });
  },

  expectApiErrorResponse: async (response: Response, apiError: ApiError) => {
    expect(response.status).toBe(apiError.status);
    const data = await response.json();
    expect(data.error).toBe(apiError.message);
    expect(data.service).toBe(apiError.service);
    expect(data.details).toEqual(apiError.details);
  },

  expectGenericErrorResponse: async (response: Response) => {
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({ error: "Failed to create project" });
  },
};

// Mock Setup Helper
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },
};

describe("POST /api/stakwork/create-project - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      const response = await POST(request);
      
      await TestHelpers.expectAuthenticationError(response);
    });

    test("should return 401 when session exists but user is missing", async () => {
      TestHelpers.setupSessionWithoutUser();

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      const response = await POST(request);
      
      await TestHelpers.expectAuthenticationError(response);
    });

    test("should proceed with valid session", async () => {
      TestHelpers.setupAuthenticatedUser();
      const mockProject = TestDataFactory.createMockProject();
      mockCreateProject.mockResolvedValue(mockProject);

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockCreateProject).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    const validationTestCases = [
      {
        name: "title",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).title;
          return data;
        },
      },
      {
        name: "description", 
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).description;
          return data;
        },
      },
      {
        name: "budget",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).budget;
          return data;
        },
      },
      {
        name: "skills",
        createInvalidData: () => {
          const data = TestDataFactory.createValidProjectData();
          delete (data as any).skills;
          return data;
        },
      },
    ];

    test.each(validationTestCases)(
      "should return 400 when $name is missing",
      async ({ createInvalidData }) => {
        const request = TestHelpers.createMockRequest(createInvalidData());
        const response = await POST(request);
        
        await TestHelpers.expectValidationError(
          response,
          "Missing required fields: title, description, budget, skills"
        );
      }
    );

    test("should return 400 when multiple required fields are missing", async () => {
      const invalidData = { title: "Test" }; // Missing description, budget, skills

      const request = TestHelpers.createMockRequest(invalidData);
      const response = await POST(request);
      
      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: title, description, budget, skills"
      );
    });

    test("should accept request with only required fields (name, workflow_id, workflow_params are optional)", async () => {
      const mockProject = TestDataFactory.createMockProject();
      mockCreateProject.mockResolvedValue(mockProject);

      const minimalData = TestDataFactory.createMinimalProjectData();
      const request = TestHelpers.createMockRequest(minimalData);
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateProject).toHaveBeenCalledWith({
        ...minimalData,
        name: undefined,
        workflow_id: undefined,
        workflow_params: undefined,
      });
    });
  });

  describe("Success Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should successfully create project with all fields", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      const mockProject = TestDataFactory.createMockProject({
        title: projectData.title,
        description: projectData.description,
        budget: projectData.budget,
        skills: projectData.skills,
      });

      mockCreateProject.mockResolvedValue(mockProject);

      const request = TestHelpers.createMockRequest(projectData);
      const response = await POST(request);
      
      await TestHelpers.expectSuccessfulResponse(response, mockProject);
      
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

    test("should pass through all workflow parameters correctly", async () => {
      const projectData = TestDataFactory.createValidProjectData();
      mockCreateProject.mockResolvedValue(TestDataFactory.createMockProject());

      const request = TestHelpers.createMockRequest(projectData);
      await POST(request);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_params: projectData.workflow_params,
        })
      );
    });

    test("should return project data exactly as returned by service", async () => {
      const mockProject = TestDataFactory.createMockProject({
        id: "project-456",
        title: "Complex Project",
        status: "ACTIVE",
        metadata: { created_by: "user-123" },
      });

      mockCreateProject.mockResolvedValue(mockProject);

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      const response = await POST(request);
      
      await TestHelpers.expectSuccessfulResponse(response, mockProject);
    });
  });

  describe("ApiError Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    const apiErrorTestCases = [
      {
        name: "400 ApiError from service",
        apiError: TestDataFactory.createApiError({
          message: "Invalid project configuration",
          status: 400,
          details: { field: "budget", issue: "must be positive" },
        }),
      },
      {
        name: "404 ApiError from service", 
        apiError: TestDataFactory.createApiError({
          message: "Workflow not found",
          status: 404,
          details: { workflow_id: 999 },
        }),
      },
      {
        name: "500 ApiError from service",
        apiError: TestDataFactory.createApiError({
          message: "Internal server error",
          status: 500,
          details: { error: "Database connection failed" },
        }),
      },
      {
        name: "503 ApiError from service",
        apiError: TestDataFactory.createApiError({
          message: "Service unavailable",
          status: 503,
          details: { retry_after: 30 },
        }),
      },
    ];

    test.each(apiErrorTestCases)(
      "should handle $name",
      async ({ apiError }) => {
        mockCreateProject.mockRejectedValue(apiError);

        const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
        const response = await POST(request);
        
        await TestHelpers.expectApiErrorResponse(response, apiError);
      }
    );

    test("should preserve all ApiError properties in response", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Custom error message",
        status: 422,
        details: {
          validation_errors: [
            { field: "title", message: "Too long" },
            { field: "budget", message: "Exceeds limit" },
          ],
        },
      });

      mockCreateProject.mockRejectedValue(apiError);

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      const response = await POST(request);
      
      await TestHelpers.expectApiErrorResponse(response, apiError);
    });
  });

  describe("Generic Error Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    const genericErrorTestCases = [
      {
        name: "generic Error and return 500",
        error: new Error("Unexpected error occurred"),
      },
      {
        name: "string errors and return 500",
        error: "String error",
      },
      {
        name: "null/undefined errors and return 500", 
        error: null,
      },
      {
        name: "errors without status property and return 500",
        error: {
          message: "Error without status",
          code: "UNKNOWN",
        },
      },
    ];

    test.each(genericErrorTestCases)(
      "should handle $name",
      async ({ error }) => {
        mockCreateProject.mockRejectedValue(error);

        const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
        const response = await POST(request);
        
        await TestHelpers.expectGenericErrorResponse(response);
      }
    );

    test("should log errors to console", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const testError = new Error("Test error for logging");
      
      mockCreateProject.mockRejectedValue(testError);

      const request = TestHelpers.createMockRequest(TestDataFactory.createValidProjectData());
      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error creating Stakwork project:",
        testError
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    const edgeCaseTestCases = [
      {
        name: "empty skills array",
        createData: () => ({
          ...TestDataFactory.createValidProjectData(),
          skills: [],
        }),
        expectedContaining: { skills: [] },
      },
      {
        name: "zero budget",
        createData: () => ({
          ...TestDataFactory.createValidProjectData(),
          budget: 0,
        }),
        expectedContaining: { budget: 0 },
      },
      {
        name: "special characters in project fields",
        createData: () => ({
          ...TestDataFactory.createValidProjectData(),
          title: "Test Project: ñáéíóú & símböls!",
          description: "Description with émojis 🚀 and símböls",
        }),
        expectedContaining: {
          title: "Test Project: ñáéíóú & símböls!",
          description: "Description with émojis 🚀 and símböls",
        },
      },
      {
        name: "very large workflow_params object",
        createData: () => ({
          ...TestDataFactory.createValidProjectData(),
          workflow_params: {
            set_var: {
              attributes: {
                vars: Object.fromEntries(
                  Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`])
                ),
              },
            },
          },
        }),
        expectedContaining: {
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
        },
      },
    ];

    test.each(edgeCaseTestCases)(
      "should handle $name",
      async ({ createData, expectedContaining }) => {
        mockCreateProject.mockResolvedValue(TestDataFactory.createMockProject());

        const testData = createData();
        const request = TestHelpers.createMockRequest(testData);
        const response = await POST(request);

        expect(response.status).toBe(201);
        expect(mockCreateProject).toHaveBeenCalledWith(
          expect.objectContaining(expectedContaining)
        );
      }
    );

    test("should handle empty string title (validation should catch this)", async () => {
      const dataWithEmptyTitle = {
        ...TestDataFactory.createValidProjectData(),
        title: "",
      };

      const request = TestHelpers.createMockRequest(dataWithEmptyTitle);
      const response = await POST(request);
      
      // Empty string is falsy, so validation should fail
      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: title, description, budget, skills"
      );
    });
  });
});
