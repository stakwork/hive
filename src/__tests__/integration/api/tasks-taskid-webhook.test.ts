import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { PUT } from "@/app/api/tasks/[taskId]/webhook/route";
import { createRequestWithHeaders } from "@/__tests__/support/helpers";

describe("PUT /api/tasks/[taskId]/webhook", () => {
  const API_TOKEN = "test-api-token";

  beforeEach(async () => {
    process.env.API_TOKEN = API_TOKEN;

    // Clean up test data
    await db.task.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  describe("Authentication", () => {
    it("should return 401 when API token is missing", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/webhook",
        "PUT",
        { "Content-Type": "application/json" },
        { branch: "feature/test" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when API token is invalid", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/webhook",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": "invalid-token",
        },
        { branch: "feature/test" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when branch is not a string", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: 123 }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Branch must be a string");
    });

    it("should return 400 when summary is not a string or null", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: 123 }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Summary must be a string or null");
    });

    it("should return 400 when summary is an object", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: { text: "invalid" } }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Summary must be a string or null");
    });

    it("should return 400 when summary is an array", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: ["invalid"] }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Summary must be a string or null");
    });

    it("should return 400 when no valid fields to update", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        {}
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("No valid fields to update");
    });
  });

  describe("Task Existence", () => {
    it("should return 404 when task does not exist", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/non-existent-task-id/webhook",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: "feature/test" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "non-existent-task-id" }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 when task is soft-deleted", async () => {
      const testData = await createTestTask({ deleted: true });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: "feature/test" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Branch Updates", () => {
    it("should update task branch and persist to database", async () => {
      const testData = await createTestTask();

      const newBranch = "feature/new-feature";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: newBranch }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.branch).toBe(newBranch);
      expect(data.data.id).toBe(testData.task.id);
      expect(data.data.workspaceId).toBe(testData.workspace.id);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.branch).toBe(newBranch);
    });

    it("should trim whitespace from branch before updating", async () => {
      const testData = await createTestTask();

      const branchWithWhitespace = "  feature/test-branch  ";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: branchWithWhitespace }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.branch).toBe("feature/test-branch");

      // Verify trimmed branch in database
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.branch).toBe("feature/test-branch");
    });
  });

  describe("Summary Updates", () => {
    it("should update task summary with valid markdown string", async () => {
      const testData = await createTestTask();

      const summary = "## Task Complete\n\n- Fixed bug in authentication\n- Added tests\n- Updated docs";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.summary).toBe(summary);
      expect(data.data.id).toBe(testData.task.id);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.summary).toBe(summary);
    });

    it("should trim whitespace from summary before updating", async () => {
      const testData = await createTestTask();

      const summaryWithWhitespace = "  Task completed successfully  ";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: summaryWithWhitespace }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.summary).toBe("Task completed successfully");

      // Verify trimmed summary in database
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.summary).toBe("Task completed successfully");
    });

    it("should clear summary when null is provided", async () => {
      // Create task with existing summary
      const testData = await createTestTask({ summary: "Existing summary" });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: null }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.summary).toBeNull();

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.summary).toBeNull();
    });

    it("should clear summary when empty string is provided", async () => {
      // Create task with existing summary
      const testData = await createTestTask({ summary: "Existing summary" });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: "" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.summary).toBeNull();

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.summary).toBeNull();
    });

    it("should handle long markdown summary", async () => {
      const testData = await createTestTask();

      const longSummary = `# Task Completion Report

## Overview
This task involved implementing a new feature for the application.

## Changes Made
- **Backend**: Updated API endpoints
- **Frontend**: Added new UI components
- **Tests**: Added comprehensive test coverage
- **Docs**: Updated README and API documentation

## Test Results
\`\`\`
✓ Unit tests: 45 passed
✓ Integration tests: 12 passed
✓ E2E tests: 8 passed
\`\`\`

## Deployment Notes
- Database migrations required
- No breaking changes
- Backward compatible

## Next Steps
1. Monitor production metrics
2. Gather user feedback
3. Plan follow-up improvements`;

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: longSummary }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.summary).toBe(longSummary);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.summary).toBe(longSummary);
    });
  });

  describe("Combined Updates", () => {
    it("should update both branch and summary in single request", async () => {
      const testData = await createTestTask();

      const newBranch = "feature/combined-update";
      const newSummary = "Updated both fields successfully";

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: newBranch, summary: newSummary }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.branch).toBe(newBranch);
      expect(data.data.summary).toBe(newSummary);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.branch).toBe(newBranch);
      expect(updatedTask?.summary).toBe(newSummary);
    });

    it("should update branch and clear summary", async () => {
      const testData = await createTestTask({ summary: "Existing summary" });

      const newBranch = "feature/new-branch";

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: newBranch, summary: null }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.branch).toBe(newBranch);
      expect(data.data.summary).toBeNull();

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.branch).toBe(newBranch);
      expect(updatedTask?.summary).toBeNull();
    });
  });

  describe("Response Format", () => {
    it("should include summary field in response", async () => {
      const testData = await createTestTask();

      const summary = "Test summary";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("title");
      expect(data.data).toHaveProperty("branch");
      expect(data.data).toHaveProperty("summary");
      expect(data.data).toHaveProperty("workspaceId");
      expect(data.data.summary).toBe(summary);
    });

    it("should include null summary in response when task has no summary", async () => {
      const testData = await createTestTask();

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: "feature/test" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data).toHaveProperty("summary");
      expect(data.data.summary).toBeNull();
    });
  });

  describe("Data Integrity", () => {
    it("should not modify other task fields during webhook update", async () => {
      const testData = await createTestTask({
        title: "Original Title",
        description: "Original description",
        status: "TODO",
        priority: "HIGH",
      });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { branch: "feature/test", summary: "New summary" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify only branch and summary were changed
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe("Original Title");
      expect(updatedTask?.description).toBe("Original description");
      expect(updatedTask?.status).toBe("TODO");
      expect(updatedTask?.priority).toBe("HIGH");
      expect(updatedTask?.branch).toBe("feature/test");
      expect(updatedTask?.summary).toBe("New summary");
    });

    it("should update updatedAt timestamp when fields change", async () => {
      const testData = await createTestTask();
      const originalUpdatedAt = testData.task.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/webhook`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { summary: "New summary" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify updatedAt was changed
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    });
  });
});

// Helper function to create test task
async function createTestTask(overrides: {
  deleted?: boolean;
  summary?: string | null;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
} = {}) {
  return await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    const task = await tx.task.create({
      data: {
        title: overrides.title || "Test Task",
        description: overrides.description !== undefined ? overrides.description : "Test description",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        deleted: overrides.deleted || false,
        summary: overrides.summary !== undefined ? overrides.summary : null,
        status: (overrides.status as any) || "TODO",
        priority: (overrides.priority as any) || "MEDIUM",
      },
    });

    return { user, workspace, task };
  });
}
