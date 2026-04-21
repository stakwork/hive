import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stakwork/create-customer/route";
import { getServerSession } from "next-auth/next";
import { type ApiError } from "@/types";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/service-factory", () => {
  const mockCreateCustomer = vi.fn();
  const mockCreateSecret = vi.fn();

  return {
    stakworkService: vi.fn(() => ({
      createCustomer: mockCreateCustomer,
      createSecret: mockCreateSecret,
    })),
    __mockCreateCustomer: mockCreateCustomer,
    __mockCreateSecret: mockCreateSecret,
  };
});

vi.mock("@/lib/encryption", () => {
  const mockEncryptField = vi.fn();
  const mockDecryptField = vi.fn();
  const mockGetInstance = vi.fn(() => ({
    encryptField: mockEncryptField,
    decryptField: mockDecryptField,
  }));

  return {
    EncryptionService: {
      getInstance: mockGetInstance,
    },
    __mockEncryptField: mockEncryptField,
    __mockDecryptField: mockDecryptField,
    __mockGetInstance: mockGetInstance,
  };
});

vi.mock("@/lib/db", () => {
  const mockWorkspaceUpdate = vi.fn();
  const mockWorkspaceFindFirst = vi.fn();

  return {
    db: {
      workspace: {
        update: mockWorkspaceUpdate,
        findFirst: mockWorkspaceFindFirst,
      },
    },
    __mockWorkspaceUpdate: mockWorkspaceUpdate,
    __mockWorkspaceFindFirst: mockWorkspaceFindFirst,
  };
});

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock the workspace access helper so these unit tests stay isolated
// from `getWorkspaceById` DB plumbing. By default, every caller is
// treated as an admin of the target workspace; IDOR tests override with
// `mockValidateWorkspaceAccessById.mockResolvedValueOnce(...)`.
vi.mock("@/services/workspace", () => {
  const mockValidateWorkspaceAccessById = vi.fn();
  return {
    validateWorkspaceAccessById: mockValidateWorkspaceAccessById,
    __mockValidateWorkspaceAccessById: mockValidateWorkspaceAccessById,
  };
});

const workspaceServiceMock = vi.mocked(await import("@/services/workspace"));
const mockValidateWorkspaceAccessById =
  workspaceServiceMock.__mockValidateWorkspaceAccessById;

const mockGetServerSession = getServerSession as Mock;

// Test Data Factories
const TestDataFactory = {
  createValidUser: () => ({
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  }),

  createValidSession: () => ({
    user: TestDataFactory.createValidUser(),
  }),

  createValidWorkspace: (overrides = {}) => ({
    id: "workspace-123",
    name: "Test Workspace",
    slug: "test-workspace",
    ownerId: "user-123",
    deleted: false,
    stakworkApiKey: null,
    ...overrides,
  }),

  createStakworkResponse: (token: string) => ({
    data: {
      token,
    },
  }),

  createEncryptedData: (data: string) => ({
    data: `encrypted-${data}`,
    iv: "iv-vector",
    tag: "auth-tag",
    keyId: "default",
    version: "1",
    encryptedAt: new Date().toISOString(),
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
    return new NextRequest("http://localhost:3000/api/stakwork/create-customer", {
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
    expect(mockCreateCustomer).not.toHaveBeenCalled();
  },

  expectSuccessfulResponse: async (response: Response) => {
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toEqual({ success: true });
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
    expect(data).toEqual({ error: "Failed to create customer" });
  },

  expectInvalidResponseError: async (response: Response) => {
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({ error: "Invalid response from Stakwork API" });
  },
};

// Get exported mocks
const serviceFactoryMock = vi.mocked(await import("@/lib/service-factory"));
const encryptionMock = vi.mocked(await import("@/lib/encryption"));
const dbMock = vi.mocked(await import("@/lib/db"));

const mockCreateCustomer = serviceFactoryMock.__mockCreateCustomer;
const mockCreateSecret = serviceFactoryMock.__mockCreateSecret;
const mockEncryptField = encryptionMock.__mockEncryptField;
const mockWorkspaceUpdate = dbMock.__mockWorkspaceUpdate;
const mockWorkspaceFindFirst = dbMock.__mockWorkspaceFindFirst;

const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulCustomerCreation: (token: string) => {
    const workspace = TestDataFactory.createValidWorkspace();
    const encryptedToken = TestDataFactory.createEncryptedData(token);

    mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
    mockWorkspaceFindFirst.mockResolvedValue(workspace);
    mockEncryptField.mockReturnValue(encryptedToken);
    mockWorkspaceUpdate.mockResolvedValue({
      ...workspace,
      stakworkApiKey: JSON.stringify(encryptedToken),
    });

    return { workspace, encryptedToken };
  },
};

describe("POST /api/stakwork/create-customer - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: caller is an admin of the workspace. Individual tests can
    // override with `.mockResolvedValueOnce({ hasAccess: false, ... })`.
    mockValidateWorkspaceAccessById.mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      userRole: "OWNER",
    });
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should return 401 when session exists but user is missing", async () => {
      TestHelpers.setupSessionWithoutUser();

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should proceed with valid session", async () => {
      TestHelpers.setupAuthenticatedUser();
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockCreateCustomer).toHaveBeenCalled();
    });

    test("IDOR: returns 404 when caller lacks admin access to the workspace", async () => {
      TestHelpers.setupAuthenticatedUser();
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      // Override the default admin grant for this single call.
      mockValidateWorkspaceAccessById.mockResolvedValueOnce({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Workspace not found or access denied" });
      // Stakwork customer creation and workspace write must never run.
      expect(mockCreateCustomer).not.toHaveBeenCalled();
      expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should accept request with valid workspaceId", async () => {
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreateCustomer).toHaveBeenCalledWith("workspace-123");
    });

    test("should return 400 when workspaceId is missing", async () => {
      const request = TestHelpers.createMockRequest({});
      const response = await POST(request);

      // IDOR hardening: we no longer forward undefined/null workspaceIds
      // down to Stakwork — the request is rejected up-front.
      expect(response.status).toBe(400);
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });

    test("should return 400 when workspaceId is null", async () => {
      const request = TestHelpers.createMockRequest({ workspaceId: null });
      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });
  });

  describe("Service Layer Integration", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should successfully call createCustomer with workspaceId", async () => {
      const token = "stakwork-token-123";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledTimes(1);
      expect(mockCreateCustomer).toHaveBeenCalledWith("workspace-123");
      await TestHelpers.expectSuccessfulResponse(response);
    });

    test("should handle createCustomer throwing ApiError", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Invalid workspace configuration",
        status: 400,
        details: { field: "workspaceId" },
      });

      mockCreateCustomer.mockRejectedValue(apiError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectApiErrorResponse(response, apiError);
    });

    test("should handle createCustomer network timeout", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Request timeout",
        status: 408,
        details: { timeout: 20000 },
      });

      mockCreateCustomer.mockRejectedValue(apiError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectApiErrorResponse(response, apiError);
    });

    test("should handle createCustomer service unavailable", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Service unavailable",
        status: 503,
        service: "stakwork",
      });

      mockCreateCustomer.mockRejectedValue(apiError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectApiErrorResponse(response, apiError);
    });
  });

  describe("Response Processing", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should extract token from valid response", async () => {
      const token = "valid-token-123";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectSuccessfulResponse(response);
    });

    test("should return 500 when response has no data property", async () => {
      mockCreateCustomer.mockResolvedValue({ invalid: "response" });
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectInvalidResponseError(response);
    });

    test("should return 500 when response data has no token", async () => {
      mockCreateCustomer.mockResolvedValue({ data: {} });
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectInvalidResponseError(response);
    });

    test("should return 500 when response data is null", async () => {
      mockCreateCustomer.mockResolvedValue({ data: null });
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectInvalidResponseError(response);
    });

    test("should handle empty string token", async () => {
      const token = "";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(mockEncryptField).toHaveBeenCalledWith("stakworkApiKey", "");
      await TestHelpers.expectSuccessfulResponse(response);
    });
  });

  describe("Token Encryption", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should encrypt token with EncryptionService", async () => {
      const token = "test-token-456";
      const encryptedData = TestDataFactory.createEncryptedData(token);

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(encryptedData);
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockEncryptField).toHaveBeenCalledTimes(1);
      expect(mockEncryptField).toHaveBeenCalledWith("stakworkApiKey", token);
    });

    test("should use EncryptionService getInstance singleton", async () => {
      const token = "singleton-test-token";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockEncryptField).toHaveBeenCalledWith("stakworkApiKey", token);
    });
  });

  describe("Database Operations", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should find workspace by workspaceId", async () => {
      const token = "db-test-token";
      const workspace = TestDataFactory.createValidWorkspace({ id: "workspace-456" });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(workspace);
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(workspace);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-456" });
      await POST(request);

      expect(mockWorkspaceFindFirst).toHaveBeenCalledWith({
        where: { id: "workspace-456", deleted: false },
      });
    });

    test("should update workspace with encrypted token", async () => {
      const token = "update-test-token";
      const workspace = TestDataFactory.createValidWorkspace();
      const encryptedData = TestDataFactory.createEncryptedData(token);

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(workspace);
      mockEncryptField.mockReturnValue(encryptedData);
      mockWorkspaceUpdate.mockResolvedValue(workspace);

      const request = TestHelpers.createMockRequest({ workspaceId: workspace.id });
      await POST(request);

      expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
        where: { id: workspace.id },
        data: {
          stakworkApiKey: JSON.stringify(encryptedData),
        },
      });
    });

    test("should handle workspace not found", async () => {
      const token = "not-found-token";

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: "nonexistent-workspace" });
      const response = await POST(request);

      expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
      await TestHelpers.expectSuccessfulResponse(response);
    });

    test("should handle database connection failure", async () => {
      const dbError = new Error("Database connection failed");

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse("test-token"));
      mockWorkspaceFindFirst.mockRejectedValue(dbError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectGenericErrorResponse(response);
    });
  });

  describe("Secret Creation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("does not call createSecret", async () => {
      const token = "no-secret-token";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectSuccessfulResponse(response);
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should handle ApiError with specific status codes", async () => {
      const apiErrorTestCases = [
        {
          name: "400 Bad Request",
          apiError: TestDataFactory.createApiError({
            message: "Invalid workspace ID",
            status: 400,
            details: { field: "workspaceId" },
          }),
        },
        {
          name: "404 Not Found",
          apiError: TestDataFactory.createApiError({
            message: "Workspace not found",
            status: 404,
            details: { workspaceId: "workspace-123" },
          }),
        },
        {
          name: "500 Internal Server Error",
          apiError: TestDataFactory.createApiError({
            message: "Internal server error",
            status: 500,
            details: { error: "Database connection failed" },
          }),
        },
        {
          name: "503 Service Unavailable",
          apiError: TestDataFactory.createApiError({
            message: "Service unavailable",
            status: 503,
            details: { retry_after: 30 },
          }),
        },
      ];

      for (const { apiError } of apiErrorTestCases) {
        MockSetup.reset();
        TestHelpers.setupAuthenticatedUser();
        mockCreateCustomer.mockRejectedValue(apiError);

        const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
        const response = await POST(request);

        await TestHelpers.expectApiErrorResponse(response, apiError);
      }
    });

    test("should preserve all ApiError properties in response", async () => {
      const apiError = TestDataFactory.createApiError({
        message: "Custom error message",
        status: 422,
        service: "stakwork",
        details: {
          validation_errors: [
            { field: "workspaceId", message: "Invalid format" },
            { field: "token", message: "Missing token" },
          ],
        },
      });

      mockCreateCustomer.mockRejectedValue(apiError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectApiErrorResponse(response, apiError);
    });

    test("should handle generic Error and return 500", async () => {
      const genericError = new Error("Unexpected error occurred");

      mockCreateCustomer.mockRejectedValue(genericError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectGenericErrorResponse(response);
    });

    test("should handle string errors and return 500", async () => {
      mockCreateCustomer.mockRejectedValue("String error message");

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectGenericErrorResponse(response);
    });

    test("should handle null/undefined errors and return 500", async () => {
      mockCreateCustomer.mockRejectedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectGenericErrorResponse(response);
    });

    test("should handle errors without status property and return 500", async () => {
      const errorWithoutStatus = {
        message: "Error without status",
        code: "UNKNOWN",
      };

      mockCreateCustomer.mockRejectedValue(errorWithoutStatus);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      await TestHelpers.expectGenericErrorResponse(response);
    });

    test("should log errors to console", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const testError = new Error("Test error for logging");

      mockCreateCustomer.mockRejectedValue(testError);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error creating Stakwork customer:",
        testError
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 400 for empty workspaceId string", async () => {
      const request = TestHelpers.createMockRequest({ workspaceId: "" });
      const response = await POST(request);

      // IDOR hardening: empty string is not a valid workspaceId.
      expect(response.status).toBe(400);
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });

    test("should handle workspace with existing stakworkApiKey", async () => {
      const token = "new-token";
      const existingKey = "existing-encrypted-key";
      const workspace = TestDataFactory.createValidWorkspace({
        stakworkApiKey: existingKey,
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(workspace);
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(workspace);

      const request = TestHelpers.createMockRequest({ workspaceId: workspace.id });
      await POST(request);

      expect(mockWorkspaceUpdate).toHaveBeenCalled();
    });

    test("should handle very long workspace IDs", async () => {
      const longWorkspaceId = "workspace-" + "a".repeat(1000);
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: longWorkspaceId });
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledWith(longWorkspaceId);
      expect(response.status).toBe(201);
    });

    test("should handle special characters in workspace ID", async () => {
      const specialWorkspaceId = "workspace-!@#$%^&*()";
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: specialWorkspaceId });
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledWith(specialWorkspaceId);
      expect(response.status).toBe(201);
    });
  });
});
