import { describe, test, beforeEach, vi, expect } from "vitest";
import { DELETE } from "@/app/api/pool-manager/delete-pool/route";
import { expectSuccess, expectError, createAuthenticatedDeleteRequest } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures";

// Mock the Pool Manager service
const mockDeletePool = vi.fn();

vi.mock("@/lib/service-factory", () => ({
  poolManagerService: () => ({
    deletePool: mockDeletePool,
  }),
}));

describe("DELETE /api/pool-manager/delete-pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * SECURITY NOTE: This endpoint has a security gap - there is no ownership validation.
   * Any authenticated user can delete any pool by name. This should be addressed
   * by adding ownership checks (verify pool.owner_id === session.user.id) or
   * role-based authorization in the future.
   */

  describe("Successful Deletion", () => {
    test("successfully deletes pool when authenticated with valid name", async () => {
      // Arrange
      const user = await createTestUser();

      const poolName = "test-pool";
      const mockResponse = {
        id: "pool-123",
        name: poolName,
        status: "deleted",
        owner_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDeletePool.mockResolvedValue(mockResponse);

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: poolName },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.pool).toEqual(mockResponse);
      expect(data.pool.name).toBe(poolName);
      expect(data.pool.status).toBe("deleted");
      expect(mockDeletePool).toHaveBeenCalledWith({ name: poolName });
      expect(mockDeletePool).toHaveBeenCalledTimes(1);
    });
  });

  describe("Authentication", () => {
    test("returns 401 when not authenticated (test bypasses middleware)", async () => {
      // Act - No auth headers provided
      const request = new Request("http://localhost/api/pool-manager/delete-pool", {
        method: "DELETE",
        body: JSON.stringify({ name: "test-pool" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await DELETE(request);

      // Assert
      // Note: In tests that bypass middleware, routes return 401 from requireAuth
      // In production, middleware would return 403 before reaching the route
      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when pool name is missing", async () => {
      // Arrange
      const user = await createTestUser();

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        {}, // Missing name
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Missing required field: name", 400);
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 400 when pool name is empty string", async () => {
      // Arrange
      const user = await createTestUser();

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Missing required field: name", 400);
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 400 when pool name is null", async () => {
      // Arrange
      const user = await createTestUser();

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: null },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Missing required field: name", 400);
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Service Error Handling", () => {
    test("handles 404 pool not found error from service", async () => {
      // Arrange
      const user = await createTestUser();

      const apiError = {
        status: 404,
        service: "pool-manager",
        message: "Pool not found",
        details: { poolName: "nonexistent-pool" },
      };
      mockDeletePool.mockRejectedValue(apiError);

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "nonexistent-pool" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Pool not found", 404);
      expect(mockDeletePool).toHaveBeenCalledWith({ name: "nonexistent-pool" });
    });

    test("handles 403 forbidden error from service", async () => {
      // Arrange
      const user = await createTestUser();

      const apiError = {
        status: 403,
        service: "pool-manager",
        message: "Insufficient permissions to delete pool",
      };
      mockDeletePool.mockRejectedValue(apiError);

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "protected-pool" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Insufficient permissions", 403);
    });

    test("handles 500 service unavailable error", async () => {
      // Arrange
      const user = await createTestUser();

      const apiError = {
        status: 500,
        service: "pool-manager",
        message: "Service unavailable",
      };
      mockDeletePool.mockRejectedValue(apiError);

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "test-pool" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Service unavailable", 500);
    });

    test("handles 401 invalid API key error from service", async () => {
      // Arrange
      const user = await createTestUser();

      const apiError = {
        status: 401,
        service: "pool-manager",
        message: "Invalid or expired API key",
      };
      mockDeletePool.mockRejectedValue(apiError);

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "test-pool" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Invalid or expired API key", 401);
    });

    test("handles generic errors from service without ApiError structure", async () => {
      // Arrange
      const user = await createTestUser();

      // Generic error without ApiError structure
      mockDeletePool.mockRejectedValue(new Error("Network timeout"));

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: "test-pool" },
        user as { id: string; email: string; name: string },
      );
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Failed to delete pool", 500);
    });
  });

  describe("Malformed Requests", () => {
    test("handles malformed JSON in request body", async () => {
      // Arrange
      const user = await createTestUser();

      // Act
      const request = new Request("http://localhost/api/pool-manager/delete-pool", {
        method: "DELETE",
        body: "invalid json",
        headers: {
          "Content-Type": "application/json",
          "x-middleware-request-id": "test-request-id",
          "x-middleware-auth-status": "authenticated",
          "x-middleware-user-id": user.id,
          "x-middleware-user-email": user.email,
          "x-middleware-user-name": user.name,
        },
      });
      const response = await DELETE(request);

      // Assert
      // Since we handle malformed JSON gracefully and it becomes empty body,
      // this will fail validation with 400, not 500
      await expectError(response, "Missing required field: name", 400);
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("handles empty request body", async () => {
      // Arrange
      const user = await createTestUser();

      // Act
      const request = new Request("http://localhost/api/pool-manager/delete-pool", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-middleware-request-id": "test-request-id",
          "x-middleware-auth-status": "authenticated",
          "x-middleware-user-id": user.id,
          "x-middleware-user-email": user.email,
          "x-middleware-user-name": user.name,
        },
      });
      const response = await DELETE(request);

      // Assert
      await expectError(response, "Missing required field: name", 400);
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Service Invocation", () => {
    test("calls service with exact parameters", async () => {
      // Arrange
      const user = await createTestUser();

      const poolName = "my-specific-pool-name";
      mockDeletePool.mockResolvedValue({
        id: "pool-456",
        name: poolName,
        status: "deleted",
        owner_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Act
      const request = createAuthenticatedDeleteRequest(
        "http://localhost/api/pool-manager/delete-pool",
        { name: poolName },
        user as { id: string; email: string; name: string },
      );
      await DELETE(request);

      // Assert
      expect(mockDeletePool).toHaveBeenCalledWith({ name: poolName });
      expect(mockDeletePool).toHaveBeenCalledTimes(1);

      // Verify exact call signature
      const callArgs = mockDeletePool.mock.calls[0][0];
      expect(callArgs).toEqual({ name: poolName });
      expect(Object.keys(callArgs)).toEqual(["name"]);
    });
  });
});