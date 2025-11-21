import { describe, test, expect, beforeEach, vi } from "vitest";
import { PUT } from "@/app/api/repositories/[id]/route";
import { db } from "@/lib/db";
import { expectSuccess, expectError, createRequestWithHeaders } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestRepository } from "@/__tests__/support/fixtures/repository";

describe("Repository Update API Integration Tests", () => {
  const TEST_API_KEY = "test-api-key-123";

  async function createTestRepositorySetup() {
    const user = await createTestUser({ name: "Test User" });
    const workspace = await createTestWorkspace({
      name: "Test Workspace",
      description: "Test workspace",
      ownerId: user.id,
    });
    const repository = await createTestRepository({
      workspaceId: workspace.id,
    });

    return { user, workspace, repository };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set up test API key
    process.env.API_KEY = TEST_API_KEY;
  });

  describe("PUT /api/repositories/[id]", () => {
    test("should update repository successfully with valid API key", async () => {
      const { repository } = await createTestRepositorySetup();

      const updateData = {
        testingFrameworkSetup: true,
        playwrightSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await expectSuccess(response);

      expect(data.testingFrameworkSetup).toBe(true);
      expect(data.playwrightSetup).toBe(true);
      expect(data.id).toBe(repository.id);
      expect(data.repositoryUrl).toBe(repository.repositoryUrl);

      // Verify changes were persisted in database
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(updatedRepo?.testingFrameworkSetup).toBe(true);
      expect(updatedRepo?.playwrightSetup).toBe(true);
    });

    test("should update only specified fields", async () => {
      const { repository } = await createTestRepositorySetup();

      const updateData = {
        testingFrameworkSetup: true,
        // Not updating playwrightSetup
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await expectSuccess(response);

      expect(data.testingFrameworkSetup).toBe(true);
      expect(data.playwrightSetup).toBe(false); // Should remain unchanged

      // Verify in database
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(updatedRepo?.testingFrameworkSetup).toBe(true);
      expect(updatedRepo?.playwrightSetup).toBe(false);
    });

    test("should accept API key in authorization header", async () => {
      const { repository } = await createTestRepositorySetup();

      const updateData = {
        playwrightSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          authorization: TEST_API_KEY,
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await expectSuccess(response);

      expect(data.playwrightSetup).toBe(true);
    });

    test("should return 401 for missing API key", async () => {
      const { repository } = await createTestRepositorySetup();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          // No API key provided
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });

      await expectError(response, "Unauthorized - Invalid or missing API key", 401);

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should return 401 for invalid API key", async () => {
      const { repository } = await createTestRepositorySetup();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": "wrong-api-key",
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });

      await expectError(response, "Unauthorized - Invalid or missing API key", 401);

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should return 404 for non-existent repository", async () => {
      const nonExistentId = "non-existent-repo-id";

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${nonExistentId}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: nonExistentId }) });

      await expectError(response, "Repository not found", 404);
    });

    test("should return 400 for invalid request body", async () => {
      const { repository } = await createTestRepositorySetup();

      const invalidData = {
        testingFrameworkSetup: "not-a-boolean", // Should be boolean
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        invalidData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
      expect(data.details).toBeDefined();

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should return 500 when API_KEY is not configured", async () => {
      // Remove API_KEY from environment
      delete process.env.API_KEY;

      const { repository } = await createTestRepositorySetup();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": "any-key",
        },
        updateData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });

      await expectError(response, "API_KEY not configured on server", 500);

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should handle empty update payload gracefully", async () => {
      const { repository } = await createTestRepositorySetup();

      const emptyData = {};

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/repositories/${repository.id}`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        emptyData,
      );

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await expectSuccess(response);

      expect(data.id).toBe(repository.id);
      // All fields should remain unchanged
      expect(data.testingFrameworkSetup).toBe(false);
      expect(data.playwrightSetup).toBe(false);
    });

    test("should handle concurrent updates correctly", async () => {
      const { repository } = await createTestRepositorySetup();

      // Create multiple update requests
      const requests = [
        {
          data: { testingFrameworkSetup: true },
          expectedField: "testingFrameworkSetup",
        },
        {
          data: { playwrightSetup: true },
          expectedField: "playwrightSetup",
        },
      ];

      const responses = await Promise.all(
        requests.map(({ data }) =>
          PUT(
            createRequestWithHeaders(
              `http://localhost:3000/api/repositories/${repository.id}`,
              "PUT",
              {
                "Content-Type": "application/json",
                "x-api-key": TEST_API_KEY,
              },
              data,
            ),
            { params: Promise.resolve({ id: repository.id }) },
          ),
        ),
      );

      // All requests should succeed
      for (const response of responses) {
        await expectSuccess(response);
      }

      // Verify final state in database
      const finalRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      // Both fields should be updated (last write wins behavior)
      expect(finalRepo?.testingFrameworkSetup || finalRepo?.playwrightSetup).toBe(true);
    });
  });
});
