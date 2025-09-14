import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import type { User, Workspace, Repository } from "@prisma/client";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("Tasks API - Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("POST /api/tasks", () => {
    let testUser: User;
    let testWorkspace: Workspace;
    let testRepository: Repository;
    let nonMemberUser: User;
    let assigneeUser: User;

    beforeEach(async () => {
      // Create test users
      testUser = await db.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      nonMemberUser = await db.user.create({
        data: {
          id: `nonmember-${Date.now()}-${Math.random()}`,
          email: `nonmember-${Date.now()}@example.com`,
          name: "Non-member User",
        },
      });

      assigneeUser = await db.user.create({
        data: {
          id: `assignee-${Date.now()}-${Math.random()}`,
          email: `assignee-${Date.now()}@example.com`,
          name: "Assignee User",
        },
      });

      // Create test workspace
      const slug = `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      testWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: slug,
          ownerId: testUser.id,
        },
      });

      // Add assigneeUser as member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: assigneeUser.id,
          role: "DEVELOPER",
        },
      });

      // Create test repository
      testRepository = await db.repository.create({
        data: {
          id: `repo-${Date.now()}-${Math.random()}`,
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: testWorkspace.id,
        },
      });
    });

    test("should create task successfully with minimal data", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Test Task",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        title: "Test Task",
        description: null,
        status: "TODO",
        priority: "MEDIUM",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });
      expect(data.data.id).toBeDefined();
      expect(data.data.createdAt).toBeDefined();
    });

    test("should create task with all associations", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Complex Task",
          description: "A task with all fields",
          workspaceSlug: testWorkspace.slug,
          status: "IN_PROGRESS",
          priority: "HIGH",
          assigneeId: assigneeUser.id,
          repositoryId: testRepository.id,
          estimatedHours: 8,
          actualHours: 2,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        title: "Complex Task",
        description: "A task with all fields",
        status: "IN_PROGRESS",
        priority: "HIGH",
        workspaceId: testWorkspace.id,
        assigneeId: assigneeUser.id,
        repositoryId: testRepository.id,
        estimatedHours: 8,
        actualHours: 2,
        createdById: testUser.id,
      });
      expect(data.data.assignee).toMatchObject({
        id: assigneeUser.id,
        name: assigneeUser.name,
        email: assigneeUser.email,
      });
      expect(data.data.repository).toMatchObject({
        id: testRepository.id,
        name: testRepository.name,
        repositoryUrl: testRepository.repositoryUrl,
      });
    });

    test("should handle 'active' status mapping to IN_PROGRESS", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Active Task",
          workspaceSlug: testWorkspace.slug,
          status: "active",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.status).toBe("IN_PROGRESS");
    });

    // Workspace Membership Enforcement Tests
    test("should deny access to non-workspace members", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: nonMemberUser.id, email: nonMemberUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Unauthorized Task",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    test("should return 404 for non-existent workspace", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task for Non-existent Workspace",
          workspaceSlug: "non-existent-workspace",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    test("should deny access to deleted workspace", async () => {
      // Mark workspace as deleted
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task for Deleted Workspace",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    // Authentication Tests
    test("should return 401 for unauthenticated user", async () => {
      (getServerSession as vi.Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Unauthorized Task",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 for invalid user session", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { email: "test@example.com" }, // Missing user id
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Invalid Session",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });

    // Input Validation Tests
    test("should return 400 for missing required fields", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          description: "Task without title or workspace",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required fields: title, workspaceId");
    });

    test("should return 400 for empty title", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required fields: title, workspaceId");
    });

    // Status Validation Tests
    test("should return 400 for invalid status", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Invalid Status",
          workspaceSlug: testWorkspace.slug,
          status: "INVALID_STATUS",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid status. Must be one of:");
      expect(data.error).toContain("TODO");
      expect(data.error).toContain("IN_PROGRESS");
      expect(data.error).toContain("DONE");
      expect(data.error).toContain("CANCELLED");
    });

    test("should accept all valid status values", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const validStatuses = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];

      for (const status of validStatuses) {
        const request = new NextRequest("http://localhost:3000/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: `Task with ${status} status`,
            workspaceSlug: testWorkspace.slug,
            status: status,
          }),
          headers: { "Content-Type": "application/json" },
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.data.status).toBe(status);
      }
    });

    // Priority Validation Tests
    test("should return 400 for invalid priority", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Invalid Priority",
          workspaceSlug: testWorkspace.slug,
          priority: "INVALID_PRIORITY",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid priority. Must be one of:");
      expect(data.error).toContain("LOW");
      expect(data.error).toContain("MEDIUM");
      expect(data.error).toContain("HIGH");
    });

    test("should accept all valid priority values", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const validPriorities = ["LOW", "MEDIUM", "HIGH"];

      for (const priority of validPriorities) {
        const request = new NextRequest("http://localhost:3000/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: `Task with ${priority} priority`,
            workspaceSlug: testWorkspace.slug,
            priority: priority,
          }),
          headers: { "Content-Type": "application/json" },
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.data.priority).toBe(priority);
      }
    });

    test("should default to MEDIUM priority when not specified", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task without Priority",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.priority).toBe("MEDIUM");
    });

    // Assignee Validation Tests
    test("should return 400 for invalid assignee", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Invalid Assignee",
          workspaceSlug: testWorkspace.slug,
          assigneeId: "non-existent-user-id",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Assignee not found");
    });

    test("should return 400 for deleted assignee", async () => {
      // Mark assignee user as deleted
      await db.user.update({
        where: { id: assigneeUser.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Deleted Assignee",
          workspaceSlug: testWorkspace.slug,
          assigneeId: assigneeUser.id,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Assignee not found");
    });

    // Repository Validation Tests
    test("should return 400 for invalid repository", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Invalid Repository",
          workspaceSlug: testWorkspace.slug,
          repositoryId: "non-existent-repo-id",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Repository not found or does not belong to this workspace");
    });

    test("should return 400 for repository not in workspace", async () => {
      // Create another workspace and repository
      const otherWorkspace = await db.workspace.create({
        data: {
          name: "Other Workspace",
          slug: `other-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ownerId: testUser.id,
        },
      });

      const otherRepository = await db.repository.create({
        data: {
          id: `other-repo-${Date.now()}-${Math.random()}`,
          name: "other-repo",
          repositoryUrl: "https://github.com/other/repo",
          workspaceId: otherWorkspace.id,
        },
      });

      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Repository from Other Workspace",
          workspaceSlug: testWorkspace.slug,
          repositoryId: otherRepository.id,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Repository not found or does not belong to this workspace");
    });

    // Workspace Member Access Tests
    test("should allow workspace members to create tasks", async () => {
      // Add nonMemberUser as a workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: nonMemberUser.id,
          role: "DEVELOPER",
        },
      });

      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: nonMemberUser.id, email: nonMemberUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task by Workspace Member",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("Task by Workspace Member");
      expect(data.data.createdById).toBe(nonMemberUser.id);
    });

    test("should allow workspace owner to create tasks", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task by Workspace Owner",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("Task by Workspace Owner");
      expect(data.data.createdById).toBe(testUser.id);
    });

    // Edge Case Tests
    test("should handle malformed JSON", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create task");
    });

    test("should trim whitespace from title and description", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "  Trimmed Title  ",
          description: "  Trimmed Description  ",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.title).toBe("Trimmed Title");
      expect(data.data.description).toBe("Trimmed Description");
    });

    test("should handle null description", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Null Description",
          description: null,
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.description).toBeNull();
    });

    test("should handle empty description", async () => {
      (getServerSession as vi.Mock).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Task with Empty Description",
          description: "",
          workspaceSlug: testWorkspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.description).toBeNull();
    });
  });
});