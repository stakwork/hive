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
  createPatchRequest,
  createDeleteRequest,
} from "@/__tests__/support/helpers";

describe("Ticket API - Integration Tests", () => {
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

      // Create existing ticket
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "New Ticket",
        order: 1,
        status: TicketStatus.TODO,
        priority: Priority.MEDIUM,
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
        { id: user.id, email: user.email, name: user.name || "" }
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
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const assignee = await createTestUser();
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
          title: "Full Ticket",
          description: "Detailed description",
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          phaseId: phase.id,
          assigneeId: assignee.id,
        },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Full Ticket",
        description: "Detailed description",
        status: TicketStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        phaseId: phase.id,
        assigneeId: assignee.id,
      });
      expect(data.data.phase?.name).toBe("Test Phase");
      expect(data.data.assignee?.id).toBe(assignee.id);
    });

    test("requires authentication", async () => {

      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/tickets",
        { title: "New Ticket" },
        { id: user.id, email: user.email, name: user.name || "" }
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
        {}
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
        { id: user.id, email: user.email, name: user.name || "" }
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Ticket");
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/tickets",
        { title: "New Ticket" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "non-existent-id" }) });

      await expectError(response, "Feature not found or access denied", 404);
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
        { id: nonMember.id, email: nonMember.email, name: nonMember.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Feature not found or access denied", 403);
    });

    test("validates status enum values", async () => {
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum values", async () => {
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Invalid priority", 400);
    });

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


      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Test Ticket", phaseId: "non-existent-phase-id" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Phase not found or does not belong to this feature", 400);
    });

    test("validates assigneeId exists", async () => {
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Assignee not found", 400);
    });

    test("calculates order per phase correctly", async () => {
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

      // Create tickets in phase1
      await db.ticket.create({
        data: {
          title: "Phase 1 Ticket 1",
          featureId: feature.id,
          phaseId: phase1.id,
          order: 0,
          status: TicketStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });


      // Create ticket in phase2 - should start at order 0
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Phase 2 Ticket 1", phaseId: phase2.id },
        { id: user.id, email: user.email, name: user.name || "" }
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
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Updated Title");
      // updatedById is not included in response type
    });

    test("updates description", async () => {
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
        { description: "New description" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.description).toBe("New description");
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
        { status: TicketStatus.IN_PROGRESS },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.status).toBe(TicketStatus.IN_PROGRESS);
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
        { priority: Priority.HIGH },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.priority).toBe(Priority.HIGH);
    });

    test("updates order", async () => {
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
        { order: 5 },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.order).toBe(5);
    });

    test("updates phaseId", async () => {
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
          name: "New Phase",
          featureId: feature.id,
          order: 0,
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
        { phaseId: phase.id },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.phaseId).toBe(phase.id);
    });

    test("updates assigneeId", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const assignee = await createTestUser();
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
        { assigneeId: assignee.id },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.assigneeId).toBe(assignee.id);
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
          description: "New description",
          status: TicketStatus.DONE,
          priority: Priority.CRITICAL,
          order: 3,
        },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        title: "New Title",
        description: "New description",
        status: TicketStatus.DONE,
        priority: Priority.CRITICAL,
        order: 3,
      });
    });

    test("requires authentication", async () => {

      const request = createPatchRequest(
        "http://localhost:3000/api/tickets/test-id",
        { title: "Updated" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPatchRequest(
        "http://localhost:3000/api/tickets/non-existent-id",
        { title: "Updated" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectError(response, "Ticket not found", 404);
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
        { title: "   " },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Invalid title", 400);
    });

    test("validates status enum values", async () => {
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
        { status: "INVALID_STATUS" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum values", async () => {
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
        { priority: "INVALID_PRIORITY" },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Invalid priority", 400);
    });

    test("validates order is non-negative", async () => {
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
        { order: -1 },
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Invalid order", 400);
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
        { id: user.id, email: user.email, name: user.name || "" }
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
        `http://localhost:3000/api/tickets/${ticket.id}`
      ,
        { id: user.id, email: user.email, name: user.name || "" }
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const deletedTicket = await db.ticket.findUnique({
        where: { id: ticket.id },
      });
      expect(deletedTicket).toBeNull();
    });

    test("requires authentication", async () => {

      const request = createDeleteRequest(
        "http://localhost:3000/api/tickets/test-id"
      ,
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedDeleteRequest(
        "http://localhost:3000/api/tickets/non-existent-id"
      ,
        { id: user.id, email: user.email, name: user.name || "" }
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
        `http://localhost:3000/api/tickets/${ticket.id}`
      ,
        { id: nonMember.id, email: nonMember.email, name: nonMember.name || "" }
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Access denied", 403);
    });
  });
});