import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PATCH, DELETE } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createGetRequest,
  createPatchRequest,
  createDeleteRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers";

describe("Tickets API - Individual Ticket Operations - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/tickets/[ticketId]", () => {
    test("retrieves ticket with full details", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          description: "Test description",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: "TODO",
          priority: "MEDIUM",
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        user
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        id: ticket.id,
        title: "Test Ticket",
        description: "Test description",
        status: "TODO",
        priority: "MEDIUM",
        order: 0,
      });
      expect(data.data.feature.id).toBe(feature.id);
      expect(data.data.phase.id).toBe(phase.id);
      expect(data.data.createdBy.id).toBe(user.id);
    });

    test("requires authentication", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/tickets/test-id"
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/tickets/non-existent-id",
        user
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectNotFound(response, "Task not found");
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        nonMember
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectForbidden(response, "Access denied");
    });

    test("excludes soft-deleted tickets", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Deleted Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          deleted: true,
          deletedAt: new Date(),
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        user
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectNotFound(response, "Task not found");
    });

    test("allows workspace members to view tickets", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        member
      );

      const response = await GET(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.id).toBe(ticket.id);
    });
  });

  describe("PATCH /api/tickets/[ticketId]", () => {
    test("updates ticket title", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "Updated Title" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Updated Title");
      // Note: updatedById is not returned in the response type
    });

    test("updates ticket status", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "TODO",
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { status: "IN_PROGRESS" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.status).toBe("IN_PROGRESS");
    });

    test("updates ticket priority", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          priority: "MEDIUM",
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { priority: "HIGH" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.priority).toBe("HIGH");
    });

    test("updates ticket description", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          description: "Old description",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { description: "New description" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.description).toBe("New description");
    });

    test("updates ticket assignee", async () => {
      const owner = await createTestUser();
      const assignee = await createTestUser();
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { assigneeId: assignee.id },
        owner
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      // Check that assignee is populated with the correct id
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee?.id).toBe(assignee.id);
    });

    test("updates ticket phase", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase1.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { phaseId: phase2.id },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.phaseId).toBe(phase2.id);
    });

    test("updates multiple fields at once", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Original Title",
          description: "Old description",
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "TODO",
          priority: "LOW",
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        {
          title: "New Title",
          description: "New description",
          status: "IN_PROGRESS",
          priority: "HIGH",
        },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        title: "New Title",
        description: "New description",
        status: "IN_PROGRESS",
        priority: "HIGH",
      });
    });

    test("requires authentication", async () => {
      const request = createPatchRequest(
        "http://localhost:3000/api/tickets/test-id",
        { title: "Updated" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPatchRequest(
        "http://localhost:3000/api/tickets/non-existent-id",
        { title: "Updated" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectNotFound(response, "Task not found");
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "   " },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Title cannot be empty", 400);
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { status: "INVALID_STATUS" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { priority: "INVALID_PRIORITY" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Invalid priority", 400);
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { assigneeId: "non-existent-user" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Assignee not found", 404);
    });

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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { phaseId: "non-existent-phase" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Phase not found", 404);
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

      const ticket = await db.task.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "  Trimmed Title  " },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Trimmed Title");
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "Updated" },
        nonMember
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectForbidden(response, "Access denied");
    });

    test("persists updates to database", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "TODO",
          priority: "LOW",
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        {
          title: "Updated Title",
          status: "IN_PROGRESS",
          priority: "HIGH",
        },
        user
      );

      await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const dbTicket = await db.task.findUnique({
        where: { id: ticket.id },
      });

      expect(dbTicket).toBeDefined();
      expect(dbTicket?.title).toBe("Updated Title");
      expect(dbTicket?.status).toBe("IN_PROGRESS");
      expect(dbTicket?.priority).toBe("HIGH");
      expect(dbTicket?.updatedById).toBe(user.id);
    });
  });

  describe("DELETE /api/tickets/[ticketId]", () => {
    test("soft deletes ticket successfully", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        user
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const deletedTicket = await db.task.findUnique({
        where: { id: ticket.id },
      });
      expect(deletedTicket).toBeDefined();
      expect(deletedTicket?.deleted).toBe(true);
      expect(deletedTicket?.deletedAt).toBeDefined();
    });

    test("requires authentication", async () => {
      const request = createDeleteRequest(
        "http://localhost:3000/api/tickets/test-id"
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedDeleteRequest(
        "http://localhost:3000/api/tickets/non-existent-id",
        user
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectNotFound(response, "Task not found");
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        nonMember
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectForbidden(response, "Access denied");
    });

    test("cannot delete already deleted ticket", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          deleted: true,
          deletedAt: new Date(),
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        user
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectNotFound(response, "Task not found");
    });

    test("allows workspace owner to delete tickets", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        owner
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const deletedTicket = await db.task.findUnique({
        where: { id: ticket.id },
      });
      expect(deletedTicket?.deleted).toBe(true);
    });

    test("allows workspace member to delete tickets", async () => {
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

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        member
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });
});