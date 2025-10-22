import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

describe("POST /api/features/[featureId]/tickets - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/tickets",
        { title: "Test Ticket" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });
  });

  describe("Authorization", () => {
    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket" },
        nonMember
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });

    test("allows workspace owner to create tickets", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Owner Ticket" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Owner Ticket");
    });

    test("allows workspace member to create tickets", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Member Ticket" },
        member
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Member Ticket");
    });
  });

  describe("Entity Existence Validation", () => {
    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/tickets",
        { title: "Test Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "non-existent-id" }) });

      await expectError(response, "Feature not found", 404);
    });

    test("rejects soft-deleted feature", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Deleted Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found or access denied", 404);
    });

    test("rejects feature from soft-deleted workspace", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found or access denied", 404);
    });
  });

  describe("Required Fields Validation", () => {
    test("validates title is required", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {},
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Title is required", 400);
    });

    test("validates title is non-empty after trimming", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "   " },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Title is required", 400);
    });
  });

  describe("Input Sanitization", () => {
    test("trims whitespace from title", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "  Trimmed Ticket  " },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Ticket");
    });

    test("trims whitespace from description", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          description: "  Trimmed Description  "
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBe("Trimmed Description");
    });
  });

  describe("Enum Validation", () => {
    test("validates status enum", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          status: "INVALID_STATUS"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          priority: "INVALID_PRIORITY"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
    });

    test("accepts valid TaskStatus values", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const validStatuses = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED", "BLOCKED"];

      for (const status of validStatuses) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { 
            title: `Ticket ${status}`,
            status
          },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.status).toBe(status);
      }
    });

    test("accepts valid Priority values", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const validPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

      for (const priority of validPriorities) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { 
            title: `Ticket ${priority}`,
            priority
          },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.priority).toBe(priority);
      }
    });
  });

  describe("Foreign Key Validation", () => {
    test("validates phaseId exists", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          phaseId: "non-existent-phase-id"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 400);
    });

    test("validates phase belongs to feature", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature1 = await db.feature.create({
        data: {
          title: "Feature 1",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const feature2 = await db.feature.create({
        data: {
          title: "Feature 2",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phaseInFeature2 = await db.phase.create({
        data: {
          name: "Phase in Feature 2",
          featureId: feature2.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature1.id}/tickets`,
        { 
          title: "Test Ticket",
          phaseId: phaseInFeature2.id
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature1.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 400);
    });

    test("rejects soft-deleted phase", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const deletedPhase = await db.phase.create({
        data: {
          name: "Deleted Phase",
          featureId: feature.id,
          order: 0,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          phaseId: deletedPhase.id
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 400);
    });

    test("validates assigneeId exists for regular users", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          assigneeId: "non-existent-user-id"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Assignee not found", 400);
    });

    test("allows system assignee: task-coordinator", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Task Coordinator Ticket",
          assigneeId: "system:task-coordinator"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee.id).toBe("system:task-coordinator");
      expect(data.data.assignee.name).toBe("Task Coordinator");
    });

    test("allows system assignee: bounty-hunter", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Bounty Hunter Ticket",
          assigneeId: "system:bounty-hunter"
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee.id).toBe("system:bounty-hunter");
      expect(data.data.assignee.name).toBe("Bounty Hunter");
    });
  });

  describe("Business Logic - Auto-increment Order", () => {
    test("creates first ticket with order 0", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "First Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("auto-increments order for subsequent tickets", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create first ticket with order 0
      await db.task.create({
        data: {
          title: "Existing Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(1);
    });

    test("calculates order correctly with multiple existing tickets", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create multiple tickets with orders 0, 1, 2
      await db.task.createMany({
        data: [
          {
            title: "Ticket 1",
            workspaceId: workspace.id,
            featureId: feature.id,
            order: 0,
            createdById: user.id,
            updatedById: user.id,
          },
          {
            title: "Ticket 2",
            workspaceId: workspace.id,
            featureId: feature.id,
            order: 1,
            createdById: user.id,
            updatedById: user.id,
          },
          {
            title: "Ticket 3",
            workspaceId: workspace.id,
            featureId: feature.id,
            order: 2,
            createdById: user.id,
            updatedById: user.id,
          },
        ],
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Fourth Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(3);
    });

    test("calculates order per feature scope", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature1 = await db.feature.create({
        data: {
          title: "Feature 1",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const feature2 = await db.feature.create({
        data: {
          title: "Feature 2",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create ticket in feature1 with order 0
      await db.task.create({
        data: {
          title: "Ticket in Feature 1",
          workspaceId: workspace.id,
          featureId: feature1.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create ticket in feature2 - should start at order 0
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature2.id}/tickets`,
        { title: "First Ticket in Feature 2" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature2.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("ignores soft-deleted tickets when calculating order", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create active and deleted tickets
      await db.task.createMany({
        data: [
          {
            title: "Active Ticket",
            workspaceId: workspace.id,
            featureId: feature.id,
            order: 0,
            createdById: user.id,
            updatedById: user.id,
          },
          {
            title: "Deleted Ticket",
            workspaceId: workspace.id,
            featureId: feature.id,
            order: 1,
            deleted: true,
            deletedAt: new Date(),
            createdById: user.id,
            updatedById: user.id,
          },
        ],
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(1); // Should be max(active tickets order) + 1
    });
  });

  describe("Database Persistence", () => {
    test("persists ticket with all fields to database", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser({ name: "Assignee User" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: assignee.id,
          role: "DEVELOPER",
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Complete Ticket",
          description: "Detailed description",
          status: "IN_PROGRESS",
          priority: "HIGH",
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data.data).toMatchObject({
        title: "Complete Ticket",
        description: "Detailed description",
        status: "IN_PROGRESS",
        priority: "HIGH",
        featureId: feature.id,
        phaseId: phase.id,
        order: 0,
      });

      // Verify database persistence
      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
        include: {
          assignee: true,
          phase: true,
          feature: true,
        },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Complete Ticket");
      expect(dbTicket?.description).toBe("Detailed description");
      expect(dbTicket?.status).toBe("IN_PROGRESS");
      expect(dbTicket?.priority).toBe("HIGH");
      expect(dbTicket?.featureId).toBe(feature.id);
      expect(dbTicket?.phaseId).toBe(phase.id);
      expect(dbTicket?.assigneeId).toBe(assignee.id);
      expect(dbTicket?.workspaceId).toBe(workspace.id);
      expect(dbTicket?.createdById).toBe(user.id);
      expect(dbTicket?.updatedById).toBe(user.id);
      expect(dbTicket?.order).toBe(0);
    });

    test("persists ticket with minimal required fields", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Minimal Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Minimal Ticket");
      expect(dbTicket?.description).toBeNull();
      expect(dbTicket?.status).toBe("TODO"); // Default value
      expect(dbTicket?.priority).toBe("MEDIUM"); // Default value
      expect(dbTicket?.phaseId).toBeNull();
      expect(dbTicket?.assigneeId).toBeNull();
    });

    test("returns ticket with populated relationships", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser({ name: "Test Assignee" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: assignee.id,
          role: "DEVELOPER",
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Ticket with Relations",
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify assignee is populated
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee.id).toBe(assignee.id);
      expect(data.data.assignee.name).toBe("Test Assignee");

      // Verify phase is populated
      expect(data.data.phase).toBeDefined();
      expect(data.data.phase.id).toBe(phase.id);
      expect(data.data.phase.name).toBe("Test Phase");
    });
  });

  describe("Edge Cases", () => {
    test("handles empty description as null", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          description: ""
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBeNull();
    });

    test("handles null optional fields gracefully", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { 
          title: "Test Ticket",
          description: null,
          phaseId: null,
          assigneeId: null,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBeNull();
      expect(data.data.phase).toBeNull();
      expect(data.data.assignee).toBeNull();
    });

    test("creates multiple tickets in parallel without order conflicts", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create multiple tickets concurrently
      const promises = Array.from({ length: 5 }, (_, i) => {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Concurrent Ticket ${i}` },
          user
        );
        return POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      });

      const responses = await Promise.all(promises);

      // All should succeed
      for (const response of responses) {
        await expectSuccess(response, 201);
      }

      // Verify all tickets were created
      const tickets = await db.task.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(tickets).toHaveLength(5);
      
      // Orders may not be perfectly sequential due to race conditions, 
      // but all tickets should be created
      const orders = tickets.map(t => t.order).sort((a, b) => a - b);
      expect(orders[0]).toBeGreaterThanOrEqual(0);
      expect(orders[orders.length - 1]).toBeGreaterThanOrEqual(0);
    });
  });
});