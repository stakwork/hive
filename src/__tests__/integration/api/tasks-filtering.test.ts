import { describe, test, expect } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import {
  expectSuccess,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";

// Local helper for creating tasks with filtering-specific fields
async function createTaskForFiltering(
  workspaceId: string,
  userId: string,
  options: {
    title?: string;
    workflowStatus?: WorkflowStatus;
    podId?: string | null;
    status?: TaskStatus;
    archived?: boolean;
    deleted?: boolean;
    systemAssigneeType?: string | null;
    priority?: string;
    createdAt?: Date;
  }
) {
  const taskId = generateUniqueId("task");

  return db.task.create({
    data: {
      id: taskId,
      title: options.title || `Test Task ${taskId}`,
      description: "Test description",
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: options.status || TaskStatus.IN_PROGRESS,
      workflowStatus: options.workflowStatus || WorkflowStatus.PENDING,
      podId: options.podId !== undefined ? options.podId : null,
      archived: options.archived || false,
      archivedAt: options.archived ? new Date() : null,
      deleted: options.deleted || false,
      ...(options.systemAssigneeType !== undefined && { systemAssigneeType: options.systemAssigneeType as any }),
      ...(options.priority !== undefined && { priority: options.priority as any }),
      ...(options.createdAt !== undefined && { createdAt: options.createdAt }),
    },
  });
}

// Cleanup helper
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

describe("GET /api/tasks - Status and Pod Filtering", () => {
  describe("Status Filter (status=running)", () => {
    test("filters tasks by status=running (workflowStatus=IN_PROGRESS)", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create tasks with different workflow statuses
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running Task 1",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running Task 2",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Pending Task",
        workflowStatus: WorkflowStatus.PENDING,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Completed Task",
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        const expectedRunningTasksCount = 2; // Created above with IN_PROGRESS status
        expect(data.data).toHaveLength(expectedRunningTasksCount);
        expect(data.data.every((t: any) => t.title.includes("Running"))).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("accepts direct WorkflowStatus enum values for status parameter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Completed Task",
        workflowStatus: WorkflowStatus.COMPLETED,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Failed Task",
        workflowStatus: WorkflowStatus.FAILED,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=COMPLETED`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Completed Task");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns 400 for invalid status parameter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=invalid-status`,
          testUser
          );

        const response = await GET(request);

        await expectError(response, "Invalid status parameter", 400);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns empty array when no tasks match status filter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create only PENDING tasks
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        workflowStatus: WorkflowStatus.PENDING,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(0);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Pod Filter (hasPod=true/false)", () => {
    test("filters tasks with hasPod=true (podId IS NOT NULL)", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create tasks with and without pods
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task with Pod 1",
        podId: "pod-123",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task with Pod 2",
        podId: "pod-456",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task without Pod",
        podId: null,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&hasPod=true`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.data.every((t: any) => t.podId !== null)).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("filters tasks with hasPod=false (podId IS NULL)", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create tasks with and without pods
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task without Pod 1",
        podId: null,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task without Pod 2",
        podId: null,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task with Pod",
        podId: "pod-789",
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&hasPod=false`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.data.every((t: any) => t.podId === null)).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns 400 for invalid hasPod parameter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&hasPod=invalid`,
          testUser
          );

        const response = await GET(request);

        await expectError(response, "Invalid hasPod parameter", 400);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Combined Filters", () => {
    test("filters by both status=running and hasPod=true", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create tasks with different combinations
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running with Pod",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-123",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running without Pod",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: null,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Pending with Pod",
        workflowStatus: WorkflowStatus.PENDING,
        podId: "pod-456",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Pending without Pod",
        workflowStatus: WorkflowStatus.PENDING,
        podId: null,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Running with Pod");
        expect(data.data[0].podId).toBe("pod-123");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("filters by status=running and hasPod=false", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running with Pod",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-123",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Running without Pod",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: null,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Completed without Pod",
        workflowStatus: WorkflowStatus.COMPLETED,
        podId: null,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=false`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Running without Pod");
        expect(data.data[0].podId).toBeNull();
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Integration with Existing Filters", () => {
    test("works with pagination", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create 15 running tasks with pods
      for (let i = 1; i <= 15; i++) {
        await createTaskForFiltering(testWorkspace.id, testUser.id, {
          title: `Running Task ${i}`,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: `pod-${i}`,
        });
      }

      try {
        // First page
        const request1 = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&page=1&limit=10`,
          testUser
        );

        const response1 = await GET(request1);
        const data1 = await expectSuccess(response1, 200);

        expect(data1.data).toHaveLength(10);
        expect(data1.pagination.totalPages).toBe(2);
        expect(data1.pagination.hasMore).toBe(true);

        // Second page
        const request2 = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&page=2&limit=10`,
          testUser
        );

        const response2 = await GET(request2);
        const data2 = await expectSuccess(response2, 200);

        expect(data2.data).toHaveLength(5);
        expect(data2.pagination.hasMore).toBe(false);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("works with search filter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Bug fix for authentication",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-123",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Feature: Add new component",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-456",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Bug fix for payment",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-789",
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&search=bug`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.data.every((t: any) => t.title.toLowerCase().includes("bug"))).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("works with archived filter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Active Running Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-123",
        archived: false,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Archived Running Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-456",
        archived: true,
      });

      try {
        // Active tasks
        const request1 = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&includeArchived=false`,
          testUser
        );

        const response1 = await GET(request1);
        const data1 = await expectSuccess(response1, 200);
        expect(data1.data).toHaveLength(1);
        expect(data1.data[0].title).toBe("Active Running Task");

        // Archived tasks
        const request2 = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&includeArchived=true`,
          testUser
        );

        const response2 = await GET(request2);
        const data2 = await expectSuccess(response2, 200);
        expect(data2.data).toHaveLength(1);
        expect(data2.data[0].title).toBe("Archived Running Task");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Edge Cases", () => {
    test("handles tasks with empty pod strings as null", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Prisma treats empty string as valid value, not null
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task with empty pod",
        podId: "",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Task with null pod",
        podId: null,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&hasPod=true`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        // Empty string is considered "has pod"
        expect(data.data).toHaveLength(1);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns correct pagination metadata with filters", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create 25 running tasks with pods
      for (let i = 1; i <= 25; i++) {
        await createTaskForFiltering(testWorkspace.id, testUser.id, {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: `pod-${i}`,
        });
      }

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&status=running&hasPod=true&page=1&limit=10`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.pagination.page).toBe(1);
        expect(data.pagination.limit).toBe(10);
        expect(data.pagination.totalCount).toBe(25);
        expect(data.pagination.totalPages).toBe(3);
        expect(data.pagination.hasMore).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("handles multiple WorkflowStatus values correctly", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Create tasks with all workflow statuses
      const statuses: WorkflowStatus[] = [
        WorkflowStatus.PENDING,
        WorkflowStatus.IN_PROGRESS,
        WorkflowStatus.COMPLETED,
        WorkflowStatus.ERROR,
        WorkflowStatus.HALTED,
        WorkflowStatus.FAILED,
      ];

      for (const status of statuses) {
        await createTaskForFiltering(testWorkspace.id, testUser.id, {
          title: `Task ${status}`,
          workflowStatus: status,
        });
      }

      try {
        // Test each status
        for (const status of statuses) {
          const request = createAuthenticatedGetRequest(
            `/api/tasks?workspaceId=${testWorkspace.id}&status=${status}`,
            testUser
          );

          const response = await GET(request);
          const data = await expectSuccess(response, 200);
          
          expect(data.data.length).toBeGreaterThanOrEqual(0);
          if (data.data.length > 0) {
            expect(data.data[0].workflowStatus).toBe(status);
          }
        }
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Queue Filter (queue=true)", () => {
    test("returns only TODO + TASK_COORDINATOR tasks", async () => {
      const testUser = await createTestUser({ name: "Queue Filter User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Queued Task 1",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Queued Task 2",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
      });
      // Not queued: wrong status
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "In Progress Task",
        status: TaskStatus.IN_PROGRESS,
        systemAssigneeType: "TASK_COORDINATOR",
      });
      // Not queued: no systemAssigneeType
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Regular TODO Task",
        status: TaskStatus.TODO,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(2);
        expect(data.data.every((t: any) => t.title.startsWith("Queued"))).toBe(true);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("excludes deleted tasks", async () => {
      const testUser = await createTestUser({ name: "Queue Delete User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Visible Queued Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Deleted Queued Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: true,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Visible Queued Task");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("excludes archived tasks", async () => {
      const testUser = await createTestUser({ name: "Queue Archive User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Active Queued Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        archived: false,
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Archived Queued Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        archived: true,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Active Queued Task");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns results ordered by priority desc then createdAt asc", async () => {
      const testUser = await createTestUser({ name: "Queue Order User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      const now = new Date();
      const t = (offset: number) => new Date(now.getTime() + offset * 1000);

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "LOW old",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "LOW",
        createdAt: t(0),
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "HIGH",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "HIGH",
        createdAt: t(2),
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "CRITICAL",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "CRITICAL",
        createdAt: t(4),
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "MEDIUM old",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "MEDIUM",
        createdAt: t(1),
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "MEDIUM new",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "MEDIUM",
        createdAt: t(3),
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(5);
        // Priority order: CRITICAL > HIGH > MEDIUM > LOW
        expect(data.data[0].title).toBe("CRITICAL");
        expect(data.data[1].title).toBe("HIGH");
        // MEDIUM old before MEDIUM new (createdAt asc)
        expect(data.data[2].title).toBe("MEDIUM old");
        expect(data.data[3].title).toBe("MEDIUM new");
        expect(data.data[4].title).toBe("LOW old");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("ignores sortBy/sortOrder params and uses fixed queue ordering", async () => {
      const testUser = await createTestUser({ name: "Queue Sort User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      const now = new Date();
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "HIGH Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "HIGH",
        createdAt: new Date(now.getTime() + 5000),
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "LOW Task",
        status: TaskStatus.TODO,
        systemAssigneeType: "TASK_COORDINATOR",
        priority: "LOW",
        createdAt: new Date(now.getTime()),
      });

      try {
        // Even with sortBy=createdAt&sortOrder=desc, queue ordering should win
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&sortBy=createdAt&sortOrder=desc&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(2);
        // HIGH comes first regardless of createdAt
        expect(data.data[0].title).toBe("HIGH Task");
        expect(data.data[1].title).toBe("LOW Task");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("returns empty array when no coordinator-queued tasks exist", async () => {
      const testUser = await createTestUser({ name: "Queue Empty User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      // Only regular tasks, no coordinator-queued ones
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Regular Task",
        status: TaskStatus.IN_PROGRESS,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&queue=true&limit=100`,
          testUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(0);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Backward Compatibility", () => {
    test("works without any filter parameters (existing behavior)", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        podId: "pod-123",
      });
      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        workflowStatus: WorkflowStatus.PENDING,
        podId: null,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        // Should return both tasks (filtered by visibility rules)
        expect(data.data.length).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });

    test("existing parameters continue to work without status/hasPod", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

      await createTaskForFiltering(testWorkspace.id, testUser.id, {
        title: "Search Test Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&search=search&page=1&limit=10`,
          testUser
          );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.success).toBe(true);
        expect(data).toHaveProperty("pagination");
      } finally {
        await cleanup([testWorkspace.id], [testUser.id]);
      }
    });
  });

  describe("Creator Filter (createdById)", () => {
    test("returns only tasks created by the specified user", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const otherUser = await createTestUser({ name: "Other User" });
      const testWorkspace = await createTestWorkspace({ ownerId: ownerUser.id });

      await createTaskForFiltering(testWorkspace.id, ownerUser.id, {
        title: "Owner Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      // Create a task owned by otherUser but in the same workspace
      await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Other User Task",
          description: "Test",
          workspaceId: testWorkspace.id,
          createdById: otherUser.id,
          updatedById: otherUser.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&createdById=${ownerUser.id}&limit=100`,
          ownerUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data.length).toBeGreaterThanOrEqual(1);
        for (const task of data.data) {
          expect(task.createdById).toBe(ownerUser.id);
        }
        const titles = data.data.map((t: { title: string }) => t.title);
        expect(titles).toContain("Owner Task");
        expect(titles).not.toContain("Other User Task");
      } finally {
        await cleanup([testWorkspace.id], [ownerUser.id, otherUser.id]);
      }
    });

    test("returns all tasks when createdById is omitted", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const otherUser = await createTestUser({ name: "Other User" });
      const testWorkspace = await createTestWorkspace({ ownerId: ownerUser.id });

      await createTaskForFiltering(testWorkspace.id, ownerUser.id, {
        title: "Owner Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Other User Task",
          description: "Test",
          workspaceId: testWorkspace.id,
          createdById: otherUser.id,
          updatedById: otherUser.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&limit=100`,
          ownerUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        const titles = data.data.map((t: { title: string }) => t.title);
        expect(titles).toContain("Owner Task");
        expect(titles).toContain("Other User Task");
      } finally {
        await cleanup([testWorkspace.id], [ownerUser.id, otherUser.id]);
      }
    });

    test("returns empty array when no tasks match the specified creator", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const otherUser = await createTestUser({ name: "Other User" });
      const testWorkspace = await createTestWorkspace({ ownerId: ownerUser.id });

      await createTaskForFiltering(testWorkspace.id, ownerUser.id, {
        title: "Owner Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      try {
        const request = createAuthenticatedGetRequest(
          `/api/tasks?workspaceId=${testWorkspace.id}&createdById=${otherUser.id}&limit=100`,
          ownerUser
        );
        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.data).toHaveLength(0);
      } finally {
        await cleanup([testWorkspace.id], [ownerUser.id, otherUser.id]);
      }
    });
  });
});
