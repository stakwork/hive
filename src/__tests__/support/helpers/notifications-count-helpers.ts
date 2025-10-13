import { NextRequest } from "next/server";

// Test Data Factories for notifications-count tests
export const NotificationCountTestDataFactory = {
  createValidSession: (userId: string = "user-123") => ({
    user: { id: userId, email: "test@example.com", name: "Test User" },
  }),

  createValidWorkspace: (ownerId: string = "user-123") => ({
    id: "workspace-123",
    ownerId,
    members: [],
  }),

  createWorkspaceWithMember: (userId: string = "member-456") => ({
    id: "workspace-123",
    ownerId: "owner-123",
    members: [{ role: "DEVELOPER" }],
  }),

  createTaskWithFormArtifact: (taskId: string = "task-1") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "FORM" }],
      },
    ],
  }),

  createTaskWithCodeArtifact: (taskId: string = "task-2") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "CODE" }],
      },
    ],
  }),

  createTaskWithNoMessages: (taskId: string = "task-3") => ({
    id: taskId,
    chatMessages: [],
  }),

  createTaskWithMultipleMessages: (taskId: string = "task-4", latestHasForm: boolean = true) => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: latestHasForm ? [{ type: "FORM" }] : [{ type: "CODE" }],
      },
    ],
  }),

  createTaskWithMultipleArtifacts: (taskId: string = "task-5") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "FORM" }, { type: "CODE" }, { type: "BROWSER" }],
      },
    ],
  }),
};

// Test Helpers for notifications-count tests
export const NotificationCountTestHelpers = {
  createGetRequest: (slug: string) => {
    return new NextRequest(`http://localhost:3000/api/workspaces/${slug}/tasks/notifications-count`, {
      method: "GET",
    });
  },

  expectAuthenticationError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  },

  expectInvalidSessionError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid user session");
  },

  expectAccessDeniedError: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Access denied");
  },

  expectWorkspaceNotFoundError: async (response: Response) => {
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found");
  },

  expectSuccessResponse: async (response: Response, expectedCount: number) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.waitingForInputCount).toBe(expectedCount);
  },

  expectUnauthorized: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
  },

  expectSuccess: async (response: Response, expectedCount: number) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.waitingForInputCount).toBe(expectedCount);
  },

  expectForbidden: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Access denied");
  },

  expectNotFound: async (response: Response) => {
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found");
  },
};
