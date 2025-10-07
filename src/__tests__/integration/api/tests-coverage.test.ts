import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tests/coverage/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { EncryptionService } from "@/lib/encryption";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock Prisma db
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => {
  const mockDecryptField = vi.fn((field: string, value: string) => `decrypted-${value}`);
  return {
    EncryptionService: {
      getInstance: vi.fn(() => ({
        decryptField: mockDecryptField,
      })),
    },
    // Export the mock so we can access it in tests
    mockDecryptField,
  };
});

// Mock fetch globally for stakgraph proxy
global.fetch = vi.fn();

// Import mocked modules
const { db } = await import("@/lib/db");
const { mockDecryptField } = await import("@/lib/encryption");

describe("GET /api/tests/coverage Integration Tests", () => {
  const mockUserId = "test-user-id";
  const mockWorkspaceId = "test-workspace-id";
  const mockSwarmId = "test-swarm-id";

  const mockSwarmWithConfig = {
    id: mockSwarmId,
    workspaceId: mockWorkspaceId,
    swarmUrl: "https://swarm.example.com/api",
    swarmApiKey: "encrypted-api-key",
    name: "test-swarm",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCoverageData = {
    coverage: {
      lines: { total: 1000, covered: 850, pct: 85 },
      statements: { total: 1200, covered: 1000, pct: 83.33 },
      functions: { total: 150, covered: 120, pct: 80 },
      branches: { total: 300, covered: 240, pct: 80 },
    },
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock decrypt function behavior
    mockDecryptField.mockReturnValue("decrypted-encrypted-api-key");
  });

  describe("Success scenarios", () => {
    test("should successfully retrieve test coverage with workspaceId", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockCoverageData);

      // Verify swarm lookup by workspaceId
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId },
      });

      // Verify stakgraph proxy call
      expect(global.fetch).toHaveBeenCalledWith(
        "https://swarm.example.com:7799/tests/coverage",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer decrypted-"),
            "x-api-token": expect.stringContaining("decrypted-"),
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should successfully retrieve test coverage with swarmId", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { swarmId: mockSwarmId }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockCoverageData);

      // Verify swarm lookup by swarmId (takes priority over workspaceId)
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: mockSwarmId },
      });
    });

    test("should prioritize swarmId when both swarmId and workspaceId provided", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { swarmId: mockSwarmId, workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      await expectSuccess(response);

      // Should use swarmId when both are provided
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: mockSwarmId },
      });
    });

    test("should handle coverage data with various formats", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      const minimalCoverageData = { coverage: { total: 100, covered: 80 } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(minimalCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toEqual(minimalCoverageData);
    });
  });

  describe("Authentication scenarios", () => {
    test("should return 401 for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);

      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return 401 for session without user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 for session without user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com", name: "Test" },
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Input validation scenarios", () => {
    test("should return 400 when both workspaceId and swarmId are missing", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        {}
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe(
        "Missing required parameter: workspaceId or swarmId"
      );
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
    });

    test("should accept request with empty string workspaceId but valid swarmId", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: "", swarmId: mockSwarmId }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.swarm.findFirst).toHaveBeenCalled();
    });
  });

  describe("Entity validation scenarios", () => {
    test("should return 404 when swarm not found", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return 404 when swarm not found by swarmId", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { swarmId: "non-existent-swarm-id" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: "non-existent-swarm-id" },
      });
    });
  });

  describe("Swarm configuration validation scenarios", () => {
    test("should return 400 when swarm missing swarmUrl", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithoutUrl = {
        ...mockSwarmWithConfig,
        swarmUrl: null,
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithoutUrl);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Test coverage is not available.");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing swarmApiKey", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithoutApiKey = {
        ...mockSwarmWithConfig,
        swarmApiKey: null,
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithoutApiKey);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Test coverage is not available.");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing both swarmUrl and swarmApiKey", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithoutConfig = {
        ...mockSwarmWithConfig,
        swarmUrl: null,
        swarmApiKey: null,
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithoutConfig);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Test coverage is not available.");
    });
  });

  describe("Stakgraph proxy scenarios", () => {
    test("should correctly construct stakgraph URL from swarmUrl hostname", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithCustomUrl = {
        ...mockSwarmWithConfig,
        swarmUrl: "https://custom-swarm.example.com/some/path",
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithCustomUrl);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      await GET(request);

      // Should use hostname with port 7799
      expect(global.fetch).toHaveBeenCalledWith(
        "https://custom-swarm.example.com:7799/tests/coverage",
        expect.any(Object)
      );
    });

    test("should return error details when stakgraph service fails", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      const errorDetails = { error: "Service unavailable", code: "SERVICE_DOWN" };
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify(errorDetails),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage data");
      expect(data.details).toEqual(errorDetails);
    });

    test("should handle stakgraph 404 response", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: "Coverage data not found" }),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage data");
    });

    test("should handle stakgraph 401 authentication error", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "Invalid API key" }),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage data");
    });

    test("should handle malformed JSON response from stakgraph", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "invalid json {",
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // When JSON parsing fails, swarmApiRequest returns undefined data
      expect(data.data).toBeUndefined();
    });

    test("should include decrypted API key in stakgraph request headers", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const encryptedApiKey = "encrypted-test-key-12345";
      const swarmWithApiKey = {
        ...mockSwarmWithConfig,
        swarmApiKey: encryptedApiKey,
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithApiKey);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      await GET(request);

      // Verify decryption was called
      expect(mockDecryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        encryptedApiKey
      );

      // Verify decrypted key used in headers
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-encrypted-api-key",
            "x-api-token": "decrypted-encrypted-api-key",
          }),
        })
      );
    });
  });

  describe("Error handling scenarios", () => {
    test("should return 500 on database error", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage");
    });

    test("should return 500 on fetch network error", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage data");
    });

    test("should return 500 on decryption error", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      // Mock decryption to throw error
      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage");
    });

    test("should return 500 on unexpected error during request processing", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      // Mock URL constructor to throw
      const originalURL = global.URL;
      global.URL = class extends originalURL {
        constructor(url: string) {
          if (url.includes("swarm.example.com")) {
            throw new Error("Invalid URL");
          }
          super(url);
        }
      } as any;

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to fetch test coverage");

      // Restore URL
      global.URL = originalURL;
    });
  });

  describe("Response format validation", () => {
    test("should return properly formatted success response", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.success).toBe(true);
      expect(typeof data.data).toBe("object");
    });

    test("should return properly formatted error response", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data.success).toBe(false);
      expect(typeof data.message).toBe("string");
    });
  });

  describe("Edge cases", () => {
    test("should handle swarmUrl with trailing slash", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithTrailingSlash = {
        ...mockSwarmWithConfig,
        swarmUrl: "https://swarm.example.com/api/",
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithTrailingSlash);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://swarm.example.com:7799/tests/coverage",
        expect.any(Object)
      );
    });

    test("should handle swarmUrl with port number", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmWithPort = {
        ...mockSwarmWithConfig,
        swarmUrl: "https://swarm.example.com:8443/api",
      };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithPort);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      // Should override port to 7799
      expect(global.fetch).toHaveBeenCalledWith(
        "https://swarm.example.com:7799/tests/coverage",
        expect.any(Object)
      );
    });

    test("should handle empty coverage data response", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: mockWorkspaceId }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toEqual({});
    });

    test("should handle very long workspaceId", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const longWorkspaceId = "a".repeat(500);
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarmWithConfig);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCoverageData),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/tests/coverage",
        { workspaceId: longWorkspaceId }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: longWorkspaceId },
      });
    });
  });
});