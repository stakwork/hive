import { describe, test, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";
import { TaskStatus } from "@prisma/client";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Test Data Setup Functions
async function createTestWorkspace(ownerId: string) {
  const slug = generateUniqueSlug("test-workspace");

  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${slug}`,
      slug,
      ownerId,
      members: {
        create: {
          userId: ownerId,
          role: "OWNER",
        },
      },
    },
  });

  return workspace;
}

async function createTestTask(
  workspaceId: string,
  userId: string,
  options: { title: string; description?: string; archived?: boolean }
) {
  const taskId = generateUniqueId("task");

  const task = await db.task.create({
    data: {
      id: taskId,
      title: options.title,
      description: options.description || null,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: TaskStatus.IN_PROGRESS, // Use IN_PROGRESS to pass visibility filter
      archived: options.archived || false,
      archivedAt: options.archived ? new Date() : null,
    },
  });

  return task;
}

// Cleanup
async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.task.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.workspaceMember.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.workspace.deleteMany({
    where: { id: { in: workspaceIds } },
  });
  await db.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

describe("GET /api/tasks - Search Functionality", () => {
  test("should search tasks by title (case-insensitive)", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    // Create tasks with different titles
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Fix authentication bug",
      description: "Update login flow",
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Add new feature",
      description: "Implement search",
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Update documentation",
      description: "Fix typos",
    });

    try {
      // Mock NextAuth session
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search for "authentication" (should match first task)
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=authentication`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("Fix authentication bug");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should search tasks by description (case-insensitive)", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task One",
      description: "Implement authentication system",
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task Two",
      description: "Add search feature",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search for "authentication" in description
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=authentication`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].description).toContain("authentication");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should search case-insensitively", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "UPPERCASE TASK",
      description: "lowercase description",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search with different case
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=uppercase`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("UPPERCASE TASK");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should return multiple matching tasks", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Fix bug in authentication",
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Fix bug in payment",
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Add new feature",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search for "bug" (should match two tasks)
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=bug`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data.every((task: any) => task.title.includes("bug"))).toBe(true);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should return empty array when no matches found", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task without search term",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search for non-existent term
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=nonexistent`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should trim whitespace from search query", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Search test task",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search with leading/trailing whitespace
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=${encodeURIComponent("  search  ")}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("Search test task");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should work with pagination", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    // Create multiple tasks with "test" in title
    for (let i = 1; i <= 15; i++) {
      await createTestTask(testWorkspace.id, testUser.id, {
        title: `Test task ${i}`,
      });
    }

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // First page
      const request1 = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=test&page=1&limit=10`
      );

      const response1 = await GET(request1);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.data).toHaveLength(10);
      expect(data1.pagination.totalPages).toBeGreaterThan(1);

      // Second page
      const request2 = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=test&page=2&limit=10`
      );

      const response2 = await GET(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.data).toHaveLength(5);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should combine search with archived filter", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Active task with keyword",
      archived: false,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Archived task with keyword",
      archived: true,
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search only in archived tasks
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=keyword&includeArchived=true`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("Archived task with keyword");
      // Note: The API doesn't return the 'archived' field in the response, only uses it for filtering
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should handle empty search parameter gracefully", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Test task",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Empty search parameter
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Should return all tasks (no filter applied)
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should handle special characters in search query", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Fix [BUG-123] authentication",
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Search with special characters
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&search=${encodeURIComponent("[BUG-123]")}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toContain("[BUG-123]");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });
});
