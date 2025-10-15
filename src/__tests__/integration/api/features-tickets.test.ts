import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
  createTestPhase,
  createTestTicket,
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
    // Authentication tests
    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/tickets",
        { title: "Test Ticket" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });

    // Authorization tests
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Member Ticket" },
        member
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Member Ticket");
      expect(data.data.createdById).toBe(member.id);
    });

    // Entity existence tests
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
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Soft delete the feature
      await db.feature.update({
        where: { id: feature.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found", 404);
    });

    // Required field tests
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "   " },
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
        { title: "Test Ticket", description: "  Trimmed Description  " },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.description).toBe("Trimmed Description");
    });

    // Enum validation tests
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
        { title: "Test Ticket", status: "INVALID_STATUS" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid status", 400);
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

      const validStatuses = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"];

      for (const status of validStatuses) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Ticket with ${status}`, status },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.status).toBe(status);
      }
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
        { title: "Test Ticket", priority: "INVALID_PRIORITY" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
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

      const validPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

      for (const priority of validPriorities) {
        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/features/${feature.id}/tickets`,
          { title: `Ticket with ${priority}`, priority },
          user
        );

        const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

        const data = await expectSuccess(response, 201);
        expect(data.data.priority).toBe(priority);
      }
    });

    // Foreign key validation tests
    test("validates phase exists and belongs to feature", async () => {
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
        { title: "Test Ticket", phaseId: "non-existent-phase" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 404);
    });

    test("validates phase belongs to correct feature", async () => {
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
        { title: "Test Ticket", phaseId: phaseInFeature2.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature1.id }) });

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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", assigneeId: "non-existent-user" },
        user
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
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeNull();
    });

    test("allows null phaseId", async () => {
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
        { title: "Test Ticket", phaseId: null },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.phase).toBeNull();
    });

    test("supports system assignee (task-coordinator)", async () => {
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
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe("system:task-coordinator");
      expect(data.data.assignee?.name).toBe("Task Coordinator");
      expect(data.data.assignee?.icon).toBe("bot");
    });

    test("supports system assignee (bounty-hunter)", async () => {
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
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe("system:bounty-hunter");
      expect(data.data.assignee?.name).toBe("Bounty Hunter");
      expect(data.data.assignee?.image).toBe("/sphinx_icon.png");
    });

    // Business logic tests - auto-increment order
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

      // Create first ticket
      await db.ticket.create({
        data: {
          title: "Existing Ticket",
          featureId: feature.id,
          order: 0,
          status: "TODO",
          priority: "MEDIUM",
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

    test("auto-increments order within specific phase", async () => {
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

      // Create first ticket in phase
      await db.ticket.create({
        data: {
          title: "Existing Ticket in Phase",
          featureId: feature.id,
          phaseId: phase.id,
          order: 0,
          status: "TODO",
          priority: "MEDIUM",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket in Phase", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(1);
      expect(data.data.phaseId).toBe(phase.id);
    });

    test("calculates order independently per phase", async () => {
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

      const phase1 = await db.phase.create({
        data: {
          name: "Phase 1",
          featureId: feature.id,
          order: 0,
        },
      });

      const phase2 = await db.phase.create({
        data: {
          name: "Phase 2",
          featureId: feature.id,
          order: 1,
        },
      });

      // Create ticket in phase 1
      await db.ticket.create({
        data: {
          title: "Ticket in Phase 1",
          featureId: feature.id,
          phaseId: phase1.id,
          order: 0,
          status: "TODO",
          priority: "MEDIUM",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create first ticket in phase 2 - should start at order 0
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "First Ticket in Phase 2", phaseId: phase2.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
      expect(data.data.phaseId).toBe(phase2.id);
    });

    // Database persistence tests
    test("persists ticket to database with all fields", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Add assignee to workspace
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
          description: "Test description",
          status: "IN_PROGRESS",
          priority: "HIGH",
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);

      // Verify database state
      const dbTicket = await db.ticket.findUnique({
        where: { id: data.data.id },
        include: { assignee: true, phase: true },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Complete Ticket");
      expect(dbTicket?.description).toBe("Test description");
      expect(dbTicket?.status).toBe("IN_PROGRESS");
      expect(dbTicket?.priority).toBe("HIGH");
      expect(dbTicket?.featureId).toBe(feature.id);
      expect(dbTicket?.phaseId).toBe(phase.id);
      expect(dbTicket?.assigneeId).toBe(assignee.id);
      expect(dbTicket?.createdById).toBe(user.id);
      expect(dbTicket?.updatedById).toBe(user.id);
    });

    test("sets default status to TODO", async () => {
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
        { title: "Ticket with default status" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.status).toBe("TODO");
    });

    test("sets default priority to MEDIUM", async () => {
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
        { title: "Ticket with default priority" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.priority).toBe("MEDIUM");
    });

    // Success cases with response validation
    test("creates ticket with minimal data (title only)", async () => {
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
      expect(data.data).toMatchObject({
        title: "Minimal Ticket",
        status: "TODO",
        priority: "MEDIUM",
        order: 0,
        createdById: user.id,
        updatedById: user.id,
      });
      expect(data.data.description).toBeNull();
      expect(data.data.assignee).toBeNull();
      expect(data.data.phase).toBeNull();
    });

    test("creates ticket with all optional fields", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Add assignee to workspace
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
          title: "Full Ticket",
          description: "Complete description",
          status: "IN_PROGRESS",
          priority: "CRITICAL",
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Full Ticket");
      expect(data.data.description).toBe("Complete description");
      expect(data.data.status).toBe("IN_PROGRESS");
      expect(data.data.priority).toBe("CRITICAL");
      expect(data.data.assignee?.id).toBe(assignee.id);
      expect(data.data.phase?.id).toBe(phase.id);
    });

    test("returns ticket with populated assignee", async () => {
      const user = await createTestUser();
      const assignee = await createTestUser({ name: "Test Assignee" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Add assignee to workspace
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Ticket with Assignee", assigneeId: assignee.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe(assignee.id);
      expect(data.data.assignee?.name).toBe("Test Assignee");
    });

    test("returns ticket with populated phase", async () => {
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
        { title: "Ticket in Phase", phaseId: phase.id },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.phase).toBeDefined();
      expect(data.data.phase?.id).toBe(phase.id);
      expect(data.data.phase?.name).toBe("Test Phase");
    });

    test("returns 201 status with complete ticket response", async () => {
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
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      expect(response.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBeDefined();
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.updatedAt).toBeDefined();
    });
  });
});