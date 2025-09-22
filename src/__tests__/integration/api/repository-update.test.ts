import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/repositories/[id]/route";
import { db } from "@/lib/db";

describe("Repository Update API Integration Tests", () => {
  const TEST_API_KEY = "test-api-key-123";

  async function createTestRepository() {
    // Create test user
    const user = await db.user.create({
      data: {
        id: `user-${Date.now()}-${Math.random()}`,
        email: `user-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${Date.now()}`,
        slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        description: "Test workspace",
        ownerId: user.id,
      },
    });

    // Create test repository
    const repository = await db.repository.create({
      data: {
        name: `Test Repository ${Date.now()}`,
        repositoryUrl: `https://github.com/test/repo-${Date.now()}`,
        branch: "main",
        workspaceId: workspace.id,
        testingFrameworkSetup: false,
        playwrightSetup: false,
      },
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
      const { repository } = await createTestRepository();

      const updateData = {
        testingFrameworkSetup: true,
        playwrightSetup: true,
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
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
      const { repository } = await createTestRepository();

      const updateData = {
        testingFrameworkSetup: true,
        // Not updating playwrightSetup
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
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
      const { repository } = await createTestRepository();

      const updateData = {
        playwrightSetup: true,
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "authorization": TEST_API_KEY,
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.playwrightSetup).toBe(true);
    });

    test("should return 401 for missing API key", async () => {
      const { repository } = await createTestRepository();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // No API key provided
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized - Invalid or missing API key");

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should return 401 for invalid API key", async () => {
      const { repository } = await createTestRepository();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "wrong-api-key",
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized - Invalid or missing API key");

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

      const request = new NextRequest(`http://localhost:3000/api/repositories/${nonExistentId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: nonExistentId }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Repository not found");
    });

    test("should return 400 for invalid request body", async () => {
      const { repository } = await createTestRepository();

      const invalidData = {
        testingFrameworkSetup: "not-a-boolean", // Should be boolean
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify(invalidData),
      });

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

      const { repository } = await createTestRepository();

      const updateData = {
        testingFrameworkSetup: true,
      };

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "any-key",
        },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("API_KEY not configured on server");

      // Verify repository was not changed
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(unchangedRepo?.testingFrameworkSetup).toBe(false);
    });

    test("should handle empty update payload gracefully", async () => {
      const { repository } = await createTestRepository();

      const emptyData = {};

      const request = new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify(emptyData),
      });

      const response = await PUT(request, { params: Promise.resolve({ id: repository.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(repository.id);
      // All fields should remain unchanged
      expect(data.testingFrameworkSetup).toBe(false);
      expect(data.playwrightSetup).toBe(false);
    });

    test("should handle concurrent updates correctly", async () => {
      const { repository } = await createTestRepository();

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
            new NextRequest(`http://localhost:3000/api/repositories/${repository.id}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": TEST_API_KEY,
              },
              body: JSON.stringify(data),
            }),
            { params: Promise.resolve({ id: repository.id }) }
          )
        )
      );

      // All requests should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
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