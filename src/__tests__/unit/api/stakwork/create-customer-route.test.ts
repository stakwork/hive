import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stakwork/create-customer/route";
import { auth } from "@/lib/auth";
import { type ApiError } from "@/types";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  authOptions: {},
}));

// Mock function declarations - will be assigned after vi.mocked() imports

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
  const mockSwarmFindFirst = vi.fn();

  return {
    db: {
      workspace: {
        update: mockWorkspaceUpdate,
        findFirst: mockWorkspaceFindFirst,
      },
      swarm: {
        findFirst: mockSwarmFindFirst,
      },
    },
    __mockWorkspaceUpdate: mockWorkspaceUpdate,
    __mockWorkspaceFindFirst: mockWorkspaceFindFirst,
    __mockSwarmFindFirst: mockSwarmFindFirst,
  };
});

const mockAuth = auth as Mock;

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

  createValidSwarm: (overrides = {}) => ({
    id: "swarm-123",
    workspaceId: "workspace-123",
    name: "test-swarm",
    swarmId: "swarm-id-123",
    swarmUrl: "https://test-swarm.example.com",
    swarmSecretAlias: "{{SWARM_API_KEY}}",
    swarmApiKey: JSON.stringify({
      data: "encrypted-swarm-key",
      iv: "iv-123",
      tag: "tag-123",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    }),
    status: "ACTIVE",
    services: [],
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
    (auth as Mock).mockResolvedValue(TestDataFactory.createValidSession());
  },

  setupUnauthenticatedUser: () => {
    (auth as Mock).mockResolvedValue(null);
  },

  setupSessionWithoutUser: () => {
    (auth as Mock).mockResolvedValue({ user: null });
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
const mockDecryptField = encryptionMock.__mockDecryptField;
const mockGetInstance = encryptionMock.__mockGetInstance;
const mockWorkspaceUpdate = dbMock.__mockWorkspaceUpdate;
const mockWorkspaceFindFirst = dbMock.__mockWorkspaceFindFirst;
const mockSwarmFindFirst = dbMock.__mockSwarmFindFirst;

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
    mockSwarmFindFirst.mockResolvedValue(null);

    return { workspace, encryptedToken };
  },

  setupWithSwarm: (token: string, swarmApiKey: string) => {
    const workspace = TestDataFactory.createValidWorkspace();
    const swarm = TestDataFactory.createValidSwarm();
    const encryptedToken = TestDataFactory.createEncryptedData(token);

    mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
    mockWorkspaceFindFirst.mockResolvedValue(workspace);
    mockEncryptField.mockReturnValue(encryptedToken);
    mockWorkspaceUpdate.mockResolvedValue({
      ...workspace,
      stakworkApiKey: JSON.stringify(encryptedToken),
    });
    mockSwarmFindFirst.mockResolvedValue(swarm);
    mockDecryptField.mockReturnValue(swarmApiKey);
    mockCreateSecret.mockResolvedValue({ success: true });

    return { workspace, swarm, encryptedToken };
  },
};

describe("POST /api/stakwork/create-customer - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(auth).toHaveBeenCalled();
      expect(mockCreateCustomer).toHaveBeenCalled();
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

    test("should handle missing workspaceId gracefully", async () => {
      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse("test-token"));
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({});
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledWith(undefined);
    });

    test("should handle null workspaceId", async () => {
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: null });
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledWith(null);
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
        details: { timeout: 10000 },
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
      mockSwarmFindFirst.mockResolvedValue(null);

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

      // The singleton is created at module level, so getInstance is called during import
      // We verify the encryption service is used by checking encryptField was called
      expect(mockEncryptField).toHaveBeenCalledWith("stakworkApiKey", token);
    });

    test("should handle encryption service returning null token gracefully", async () => {
      const token = "null-token";
      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData("null"));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(response.status).toBe(201);
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
      mockSwarmFindFirst.mockResolvedValue(null);

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
      mockSwarmFindFirst.mockResolvedValue(null);

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
      mockSwarmFindFirst.mockResolvedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: "nonexistent-workspace" });
      const response = await POST(request);

      expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
      await TestHelpers.expectSuccessfulResponse(response);
    });

    test("should query swarm after workspace update", async () => {
      const token = "swarm-query-token";
      const workspace = TestDataFactory.createValidWorkspace();

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(workspace);
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(workspace);
      mockSwarmFindFirst.mockResolvedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: workspace.id });
      await POST(request);

      expect(mockSwarmFindFirst).toHaveBeenCalledWith({
        where: { workspaceId: workspace.id },
      });
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

  describe("Secret Creation Logic", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should not create secret when swarm is not found", async () => {
      const token = "no-swarm-token";
      MockSetup.setupSuccessfulCustomerCreation(token);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockSwarmFindFirst).toHaveBeenCalled();
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });

    test("should create secret when swarm has API key and secret alias", async () => {
      const token = "secret-creation-token";
      const swarmApiKey = "decrypted-swarm-key";
      MockSetup.setupWithSwarm(token, swarmApiKey);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockCreateSecret).toHaveBeenCalledWith("SWARM_API_KEY", swarmApiKey, token);
    });

    test("should sanitize swarm secret alias by removing curly braces", async () => {
      const token = "sanitize-test-token";
      const swarmApiKey = "swarm-key-123";
      const swarm = TestDataFactory.createValidSwarm({
        swarmSecretAlias: "{{CUSTOM_API_KEY}}",
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue(swarmApiKey);
      mockCreateSecret.mockResolvedValue({ success: true });

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockCreateSecret).toHaveBeenCalledWith("CUSTOM_API_KEY", swarmApiKey, token);
    });

    test("should handle double-encrypted swarm API key", async () => {
      const token = "double-encrypt-token";
      const plaintextSwarmKey = "plaintext-swarm-key";
      const firstEncryption = TestDataFactory.createEncryptedData(plaintextSwarmKey);
      const swarm = TestDataFactory.createValidSwarm({
        swarmApiKey: JSON.stringify(firstEncryption),
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);

      // First decryption returns JSON string, second decryption returns plaintext
      mockDecryptField
        .mockReturnValueOnce(JSON.stringify(firstEncryption))
        .mockReturnValueOnce(plaintextSwarmKey);

      mockCreateSecret.mockResolvedValue({ success: true });

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockDecryptField).toHaveBeenCalledTimes(2);
      expect(mockCreateSecret).toHaveBeenCalledWith("SWARM_API_KEY", plaintextSwarmKey, token);
    });

    test("should not create secret when swarmSecretAlias is empty", async () => {
      const token = "empty-alias-token";
      const swarm = TestDataFactory.createValidSwarm({
        swarmSecretAlias: "",
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockCreateSecret).not.toHaveBeenCalled();
    });

    test("should not create secret when swarmApiKey is null", async () => {
      const token = "null-swarm-key-token";
      const swarm = TestDataFactory.createValidSwarm({
        swarmApiKey: null,
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

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

    test("should handle empty workspaceId string", async () => {
      MockSetup.setupSuccessfulCustomerCreation("test-token");

      const request = TestHelpers.createMockRequest({ workspaceId: "" });
      const response = await POST(request);

      expect(mockCreateCustomer).toHaveBeenCalledWith("");
      expect(response.status).toBe(201);
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
      mockSwarmFindFirst.mockResolvedValue(null);

      const request = TestHelpers.createMockRequest({ workspaceId: workspace.id });
      await POST(request);

      expect(mockWorkspaceUpdate).toHaveBeenCalled();
    });

    test("should handle malformed JSON in swarm API key", async () => {
      const token = "malformed-json-token";
      const swarm = TestDataFactory.createValidSwarm({
        swarmApiKey: "not-valid-json",
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("plaintext-key");

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      expect(response.status).toBe(201);
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

    test("should handle createSecret throwing error", async () => {
      const token = "secret-error-token";
      const swarmApiKey = "swarm-key";

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(TestDataFactory.createValidSwarm());
      mockDecryptField.mockReturnValue(swarmApiKey);
      mockCreateSecret.mockRejectedValue(new Error("Secret creation failed"));

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      const response = await POST(request);

      // Should still return 500 due to error in createSecret
      await TestHelpers.expectGenericErrorResponse(response);
    });

    test("should handle swarm with null secret alias", async () => {
      const token = "null-alias-token";
      const swarm = TestDataFactory.createValidSwarm({
        swarmSecretAlias: null,
      });

      mockCreateCustomer.mockResolvedValue(TestDataFactory.createStakworkResponse(token));
      mockWorkspaceFindFirst.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockEncryptField.mockReturnValue(TestDataFactory.createEncryptedData(token));
      mockWorkspaceUpdate.mockResolvedValue(TestDataFactory.createValidWorkspace());
      mockSwarmFindFirst.mockResolvedValue(swarm);

      const request = TestHelpers.createMockRequest({ workspaceId: "workspace-123" });
      await POST(request);

      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });
});