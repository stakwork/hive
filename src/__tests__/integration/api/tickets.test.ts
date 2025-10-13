import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { PATCH, DELETE } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import { TicketStatus, Priority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";

describe("Tickets API - Integration Tests", () => {
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

      await db.ticket.create({
        data: {
          title: "Existing Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
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
      expect(data.data).toMatchObject({
        title: "New Ticket",
        order: 1,
        status: TicketStatus.TODO,
        priority: Priority.MEDIUM,
        featureId: feature.id,
      });
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "First Ticket" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("creates ticket with optional fields", async () => {
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
          name: "Development",
          featureId: feature.id,
          order: 0,
          status: "IN_PROGRESS",
        },
      });

      const assignee = await createTestUser({ name: "Assignee User" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: assignee.id,
          role: "DEVELOPER",
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {
          title: "Detailed Ticket",
          description: "This is a detailed description",
          phaseId: phase.id,
          assigneeId: assignee.id,
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.HIGH,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Detailed Ticket",
        description: "This is a detailed description",
        phaseId: phase.id,
        assigneeId: assignee.id,
        status: TicketStatus.IN_PROGRESS,
        priority: Priority.HIGH,
      });
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: "Assignee User",
      });
      expect(data.data.phase).toMatchObject({
        id: phase.id,
        name: "Development",
      });
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

    test("trims whitespace from title and description", async () => {
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
          title: "  Trimmed Ticket  ",
          description: "  Trimmed Description  ",
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Ticket");
      expect(data.data.description).toBe("Trimmed Description");
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {
          title: "Test Ticket",
          status: "INVALID_STATUS",
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
          priority: "INVALID_PRIORITY",
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {
          title: "Test Ticket",
          phaseId: "non-existent-phase-id",
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found", 404);
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
        {
          title: "Test Ticket",
          assigneeId: "non-existent-user-id",
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Assignee not found", 404);
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/tickets",
        { title: "New Ticket" },
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Ticket" },
        nonMember
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });

    test("creates tickets with correct order per phase", async () => {
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
          status: "IN_PROGRESS",
        },
      });

      const phase2 = await db.phase.create({
        data: {
          name: "Phase 2",
          featureId: feature.id,
          order: 1,
          status: "IN_PROGRESS",
        },
      });

      await db.ticket.create({
        data: {
          title: "Ticket in Phase 1",
          featureId: feature.id,
          phaseId: phase1.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        {
          title: "New Ticket in Phase 2",
          phaseId: phase2.id,
        },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
      expect(data.data.phaseId).toBe(phase2.id);
    });
  });

  describe("PATCH /api/tickets/[ticketId]", () => {
    test("updates title", async () => {
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

      const ticket = await db.ticket.create({
        data: {
          title: "Original Title",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
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
    });

    test("updates status", async () => {
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { status: TicketStatus.DONE },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.status).toBe(TicketStatus.DONE);
    });

    test("updates priority", async () => {
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { priority: Priority.CRITICAL },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.priority).toBe(Priority.CRITICAL);
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        {
          title: "New Title",
          description: "New Description",
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.HIGH,
        },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        title: "New Title",
        description: "New Description",
        status: TicketStatus.IN_PROGRESS,
        priority: Priority.HIGH,
      });
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
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

      await expectError(response, "Ticket not found", 404);
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
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

      await expectError(response, "Access denied", 403);
    });
  });

  describe("DELETE /api/tickets/[ticketId]", () => {
    test("deletes ticket successfully", async () => {
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
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

      const deletedTicket = await db.ticket.findUnique({
        where: { id: ticket.id },
      });
      expect(deletedTicket).toBeDefined();
      expect(deletedTicket?.deleted).toBe(true);
      expect(deletedTicket?.deletedAt).toBeDefined();
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/tickets/test-id",
        {}
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

      await expectError(response, "Ticket not found", 404);
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

      const ticket = await db.ticket.create({
        data: {
          title: "Test Ticket",
          featureId: feature.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        nonMember
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Access denied", 403);
    });
  });
});
