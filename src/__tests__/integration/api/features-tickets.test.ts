import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
  createTestPhase,
  createTestTask,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

describe("Feature Tickets API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/features/[featureId]/tickets", () => {
    test("creates ticket with auto-incremented order", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      // Create existing ticket with order 0
      await createTestTask({
        title: "Existing Ticket",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        order: 0,
        status: "TODO",
        priority: "MEDIUM",
        createdById: user.id,
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "New Ticket",
        order: 1,
        status: "TODO",
        priority: "MEDIUM",
      });
      // Note: createdById/updatedById not included in API response select
    });

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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "First Ticket", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/tickets",
        { title: "New Ticket" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates required title field", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Title is required", 400);
    });

    test("validates title is non-empty string", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "   ", phaseId: phase.id },
        user
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "  Trimmed Ticket  ", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Ticket");
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/tickets",
        { title: "New Ticket", phaseId: "phase-id" },
        user
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket", phaseId: phase.id },
        nonMember
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });

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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id, status: "INVALID_STATUS" },
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id, priority: "INVALID_PRIORITY" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
    });

    test("accepts valid status values", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const validStatuses = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"];

      for (const status of validStatuses) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Test Ticket ${status}`, phaseId: phase.id, status },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.status).toBe(status);
      }
    });

    test("accepts valid priority values", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const validPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

      for (const priority of validPriorities) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Test Ticket ${priority}`, phaseId: phase.id, priority },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.priority).toBe(priority);
      }
    });

    test("validates phase exists and belongs to feature", async () => {
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

      const phase2 = await createTestPhase({ name: "Phase in Feature 2", featureId: feature2.id, order: 0 });

      // Try to create ticket in feature1 with phase from feature2
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature1.id}/tickets`,
        { title: "Test Ticket", phaseId: phase2.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature1.id }) });

      // Note: Production code returns 404 for "not found" messages including validation errors
      await expectError(response, "Phase not found or does not belong to this feature", 404);
    });

    test("validates phase exists", async () => {
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
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      // Note: Production code returns 404 for "not found" messages including validation errors
      await expectError(response, "Phase not found or does not belong to this feature", 404);
    });

    test("validates assignee exists", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id, assigneeId: "non-existent-user-id" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      // Note: Production code returns 404 for "not found" messages including validation errors
      await expectError(response, "Assignee not found", 404);
    });

    test("allows system assignees", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const systemAssignees = ["system:task-coordinator", "system:bounty-hunter"];

      for (const assigneeId of systemAssignees) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Test Ticket ${assigneeId}`, phaseId: phase.id, assigneeId },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.assignee).toBeDefined();
        expect(data.data.assignee?.id).toBe(assigneeId);
      }
    });

    test("persists ticket to database", async () => {
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Persistent Ticket", phaseId: phase.id, description: "Test description" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      const dbTicket = await db.task.findUnique({
        where: { id: data.data.id },
        include: { feature: true, phase: true, assignee: true },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Persistent Ticket");
      expect(dbTicket?.description).toBe("Test description");
      expect(dbTicket?.feature.id).toBe(feature.id);
      expect(dbTicket?.phase.id).toBe(phase.id);
      expect(dbTicket?.createdById).toBe(user.id);
      expect(dbTicket?.updatedById).toBe(user.id);
    });

    test("populates relationships in response", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Add assignee as workspace member
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Ticket with Relations", phaseId: phase.id, assigneeId: assignee.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe(assignee.id);
      expect(data.data.assignee?.email).toBe(assignee.email);
      expect(data.data.phase).toBeDefined();
      expect(data.data.phase.id).toBe(phase.id);
      expect(data.data.phase.name).toBe("Test Phase");
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Owner Ticket", phaseId: phase.id },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
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

      // Add member to workspace
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Member Ticket", phaseId: phase.id },
        member
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("Member Ticket");
      // createdById not included in API response, verify in database instead
      const dbTicket = await db.task.findUnique({ where: { id: data.data.id } });
      expect(dbTicket?.createdById).toBe(member.id);
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found", 404);
    });

    test("calculates order within phase context", async () => {
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

      const phase1 = await createTestPhase({ name: "Phase 1", featureId: feature.id, order: 0 });

      const phase2 = await createTestPhase({ name: "Phase 2", featureId: feature.id, order: 1 });

      // Create ticket in phase1 with order 0
      await createTestTask({
        title: "Ticket in Phase 1",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase1.id,
        order: 0,
        status: "TODO",
        priority: "MEDIUM",
        createdById: user.id,
      });

      // Create new ticket in phase2 - should also get order 0 (independent counter)
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Ticket in Phase 2", phaseId: phase2.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("creates ticket with all optional fields", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
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

      const phase = await createTestPhase({ name: "Test Phase", featureId: feature.id, order: 0 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {
          title: "Complete Ticket",
          description: "Full description",
          phaseId: phase.id,
          status: "IN_PROGRESS",
          priority: "HIGH",
          assigneeId: assignee.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Complete Ticket",
        description: "Full description",
        status: "IN_PROGRESS",
        priority: "HIGH",
      });
      expect(data.data.assignee?.id).toBe(assignee.id);
      expect(data.data.phase.id).toBe(phase.id);
    });
  });
});