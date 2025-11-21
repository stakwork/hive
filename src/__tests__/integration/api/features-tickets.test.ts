import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
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
      const request = createPostRequest("http://localhost:3000/api/features/test-id/tickets", { title: "New Ticket" });

      const response = await POST(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });
  });

  describe("Authorization", () => {
    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/tickets",
        { title: "New Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "non-existent-id" }) });

      await expectError(response, "Feature not found", 404);
    });

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
        { title: "New Ticket" },
        nonMember,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });

    test("rejects deleted workspace features", async () => {
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

      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found", 404);
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
        owner,
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
        member,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Member Ticket");
    });
  });

  describe("Required Field Validation", () => {
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
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Title is required", 400);
    });

    test("validates title is non-empty string after trimming", async () => {
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
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Title is required", 400);
    });

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
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Ticket");
    });
  });

  describe("Enum Validation", () => {
    test("validates status enum - accepts valid TODO value", async () => {
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
        { title: "Test Ticket", status: "TODO" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.status).toBe("TODO");
    });

    test("validates status enum - accepts valid IN_PROGRESS value", async () => {
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
        { title: "Test Ticket", status: "IN_PROGRESS" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.status).toBe("IN_PROGRESS");
    });

    test("validates status enum - rejects invalid value", async () => {
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
        { title: "Test Ticket", status: "INVALID_STATUS" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum - accepts valid MEDIUM value", async () => {
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
        { title: "Test Ticket", priority: "MEDIUM" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.priority).toBe("MEDIUM");
    });

    test("validates priority enum - accepts valid CRITICAL value", async () => {
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
        { title: "Test Ticket", priority: "CRITICAL" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.priority).toBe("CRITICAL");
    });

    test("validates priority enum - rejects invalid value", async () => {
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
        { title: "Test Ticket", priority: "INVALID_PRIORITY" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
    });
  });

  describe("Foreign Key Validation", () => {
    test("validates phaseId exists and belongs to feature", async () => {
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

      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.phaseId).toBe(phase.id);
      expect(data.data.phase?.id).toBe(phase.id);
      expect(data.data.phase?.name).toBe("Test Phase");
    });

    test("rejects phaseId that does not belong to feature", async () => {
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

      const phase2 = await db.phase.create({
        data: {
          name: "Phase in Feature 2",
          featureId: feature2.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature1.id}/tickets`,
        { title: "Test Ticket", phaseId: phase2.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature1.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 404);
    });

    test("rejects non-existent phaseId", async () => {
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
        { title: "Test Ticket", phaseId: "non-existent-phase-id" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 404);
    });

    test("validates assigneeId exists for regular user", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
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
        { title: "Test Ticket", assigneeId: assignee.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee?.id).toBe(assignee.id);
    });

    test("rejects non-existent assigneeId", async () => {
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
        { title: "Test Ticket", assigneeId: "non-existent-user-id" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Assignee not found", 404);
    });

    test("allows null assigneeId", async () => {
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
        { title: "Test Ticket", assigneeId: null },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeNull();
    });
  });

  describe("System Assignee Support", () => {
    test("supports system:task-coordinator assignee", async () => {
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
        { title: "Test Ticket", assigneeId: "system:task-coordinator" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee?.id).toBe("system:task-coordinator");
      expect(data.data.assignee?.name).toBe("Task Coordinator");

      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
      });
      expect(dbTicket?.assigneeId).toBeNull();
      expect(dbTicket?.systemAssigneeType).toBe("TASK_COORDINATOR");
    });

    test("supports system:bounty-hunter assignee", async () => {
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
        { title: "Test Ticket", assigneeId: "system:bounty-hunter" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee?.id).toBe("system:bounty-hunter");
      expect(data.data.assignee?.name).toBe("Bounty Hunter");

      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
      });
      expect(dbTicket?.assigneeId).toBeNull();
      expect(dbTicket?.systemAssigneeType).toBe("BOUNTY_HUNTER");
    });
  });

  describe("Auto-increment Order Logic", () => {
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
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("auto-increments order for subsequent tickets in same feature", async () => {
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

      await db.task.create({
        data: {
          title: "Existing Ticket",
          featureId: feature.id,
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Second Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(1);
    });

    test("auto-increments order within phase context", async () => {
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

      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      await db.task.create({
        data: {
          title: "Existing Ticket in Phase",
          featureId: feature.id,
          phaseId: phase.id,
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Second Ticket in Phase", phaseId: phase.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(1);
      expect(data.data.phaseId).toBe(phase.id);
    });
  });

  describe("Optional Fields", () => {
    test("handles optional description field", async () => {
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
        { title: "Test Ticket", description: "Test description" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBe("Test description");
    });

    test("creates ticket without optional description", async () => {
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
        { title: "Test Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBeNull();
    });

    test("creates ticket with runBuild set to true", async () => {
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
        { title: "Test Ticket", runBuild: true },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify in database
      const task = await db.task.findUnique({
        where: { id: data.data.id },
        select: { runBuild: true },
      });
      expect(task?.runBuild).toBe(true);
    });

    test("creates ticket with runBuild set to false", async () => {
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
        { title: "Test Ticket", runBuild: false },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify in database
      const task = await db.task.findUnique({
        where: { id: data.data.id },
        select: { runBuild: true },
      });
      expect(task?.runBuild).toBe(false);
    });

    test("creates ticket with runTestSuite set to true", async () => {
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
        { title: "Test Ticket", runTestSuite: true },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify in database
      const task = await db.task.findUnique({
        where: { id: data.data.id },
        select: { runTestSuite: true },
      });
      expect(task?.runTestSuite).toBe(true);
    });

    test("creates ticket with runTestSuite set to false", async () => {
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
        { title: "Test Ticket", runTestSuite: false },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify in database
      const task = await db.task.findUnique({
        where: { id: data.data.id },
        select: { runTestSuite: true },
      });
      expect(task?.runTestSuite).toBe(false);
    });

    test("defaults runBuild and runTestSuite to true when not provided", async () => {
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
        { title: "Test Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify in database that defaults are applied
      const task = await db.task.findUnique({
        where: { id: data.data.id },
        select: { runBuild: true, runTestSuite: true },
      });
      expect(task?.runBuild).toBe(true);
      expect(task?.runTestSuite).toBe(true);
    });

    test("creates ticket without optional phaseId", async () => {
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
        { title: "Test Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.phaseId).toBeNull();
    });
  });

  describe("Database Persistence", () => {
    test("persists ticket to database with all relationships", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
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
          title: "Persisted Ticket",
          description: "Test description",
          status: "IN_PROGRESS",
          priority: "HIGH",
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
        include: {
          feature: true,
          phase: true,
          assignee: true,
          createdBy: true,
        },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Persisted Ticket");
      expect(dbTicket?.description).toBe("Test description");
      expect(dbTicket?.status).toBe("IN_PROGRESS");
      expect(dbTicket?.priority).toBe("HIGH");
      expect(dbTicket?.featureId).toBe(feature.id);
      expect(dbTicket?.phaseId).toBe(phase.id);
      expect(dbTicket?.assigneeId).toBe(assignee.id);
      expect(dbTicket?.workspaceId).toBe(workspace.id);
      expect(dbTicket?.createdById).toBe(user.id);
      expect(dbTicket?.updatedById).toBe(user.id);
      expect(dbTicket?.bountyCode).toBeDefined();
      expect(dbTicket?.bountyCode?.length).toBeGreaterThan(0);
    });

    test("generates unique bountyCode for each ticket", async () => {
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

      const request1 = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Ticket 1" },
        user,
      );

      const request2 = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Ticket 2" },
        user,
      );

      const response1 = await POST(request1, { params: Promise.resolve({ featureId: feature.id }) });
      const response2 = await POST(request2, { params: Promise.resolve({ featureId: feature.id }) });

      const data1 = await expectSuccess(response1, 201);
      const data2 = await expectSuccess(response2, 201);

      expect(data1.data.bountyCode).toBeDefined();
      expect(data2.data.bountyCode).toBeDefined();
      expect(data1.data.bountyCode).not.toBe(data2.data.bountyCode);
    });
  });

  describe("Response Format", () => {
    test("returns 201 status on success", async () => {
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
        { title: "Test Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      expect(response.status).toBe(201);
    });

    test("returns TicketResponse format with success and data", async () => {
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
        { title: "Test Ticket" },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBeDefined();
      expect(data.data.title).toBe("Test Ticket");
      expect(data.data.featureId).toBe(feature.id);
      expect(data.data.order).toBeDefined();
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.updatedAt).toBeDefined();
    });

    test("populates assignee relationship in response", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
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
        { title: "Test Ticket", assigneeId: assignee.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe(assignee.id);
      expect(data.data.assignee?.name).toBeDefined();
      expect(data.data.assignee?.email).toBeDefined();
    });

    test("populates phase relationship in response", async () => {
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

      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id },
        user,
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.phase).toBeDefined();
      expect(data.data.phase?.id).toBe(phase.id);
      expect(data.data.phase?.name).toBe("Test Phase");
    });
  });
});
