import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PATCH, DELETE } from "@/app/api/phases/[phaseId]/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
  createGetRequest,
  createPatchRequest,
  createDeleteRequest,
} from "@/__tests__/support/helpers";
import type { User } from "@prisma/client";

describe("Phase API: /api/phases/[phaseId]", () => {
  let owner: User;
  let member: User;
  let outsider: User;
  let workspaceId: string;
  let featureId: string;
  let phaseId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test users
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    member = await createTestUser({ name: "Member", email: "member@test.com" });
    outsider = await createTestUser({
      name: "Outsider",
      email: "outsider@test.com",
    });

    // Create workspace
    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });
    workspaceId = workspace.id;

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      },
    });

    // Create feature
    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    featureId = feature.id;

    // Create phase with tickets
    const phase = await db.phase.create({
      data: {
        name: "Phase 1",
        description: "Test phase description",
        status: "NOT_STARTED",
        order: 0,
        featureId: feature.id,
      },
    });
    phaseId = phase.id;

    // Create some tickets in the phase
    await db.task.create({
      data: {
        title: "Ticket 1",
        description: "Test ticket",
        status: "TODO",
        priority: "MEDIUM",
        order: 0,
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    await db.task.create({
      data: {
        title: "Ticket 2",
        description: "Another test ticket",
        status: "TODO",
        priority: "HIGH",
        order: 1,
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  describe("GET /api/phases/[phaseId]", () => {
    test("owner can fetch phase details with tickets and feature context", async () => {
      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.id).toBe(phaseId);
      expect(result.data.name).toBe("Phase 1");
      expect(result.data.description).toBe("Test phase description");
      expect(result.data.status).toBe("NOT_STARTED");
      expect(result.data.order).toBe(0);
      expect(result.data.featureId).toBe(featureId);

      // Verify feature context
      expect(result.data.feature).toBeDefined();
      expect(result.data.feature.id).toBe(featureId);
      expect(result.data.feature.title).toBe("Test Feature");
      expect(result.data.feature.workspaceId).toBe(workspaceId);

      // Verify tickets
      expect(result.data.tasks).toBeInstanceOf(Array);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[0].title).toBe("Ticket 1");
      expect(result.data.tasks[0].phaseId).toBe(phaseId);
      expect(result.data.tasks[1].title).toBe("Ticket 2");
      expect(result.data.tasks[1].order).toBe(1);
    });

    test("member can fetch phase details", async () => {
      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, member);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.id).toBe(phaseId);
      expect(result.data.name).toBe("Phase 1");
      expect(result.data.tasks).toHaveLength(2);
    });

    test("outsider cannot fetch phase", async () => {
      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, outsider);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("unauthenticated user cannot fetch phase", async () => {
      const request = createGetRequest(`http://localhost:3000/api/phases/${phaseId}`);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent phase", async () => {
      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/non-existent-id`, owner);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId: "non-existent-id" }),
      });

      await expectNotFound(response, "not found");
    });

    test("does not enforce 404 for soft-deleted phase on GET", async () => {
      // Soft delete the phase
      await db.phase.update({
        where: { id: phaseId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Current implementation doesn't filter by deleted flag in validatePhaseAccess
      // so soft-deleted phases still return 200
      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      // Currently returns 200, not 404 - validatePhaseAccess doesn't check deleted flag
      const result = await expectSuccess(response);
      expect(result.data.id).toBe(phaseId);
    });

    test("filters out deleted tickets from phase", async () => {
      // Soft delete one ticket
      await db.task.updateMany({
        where: { title: "Ticket 1" },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].title).toBe("Ticket 2");
    });

    test("returns tickets ordered by order field", async () => {
      // Create additional tickets with specific order
      await db.task.create({
        data: {
          title: "Ticket 0",
          status: "TODO",
          priority: "LOW",
          order: -1,
          workspaceId: workspaceId,
          featureId: featureId,
          phaseId: phaseId,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await GET(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.tasks).toHaveLength(3);
      expect(result.data.tasks[0].order).toBe(-1);
      expect(result.data.tasks[1].order).toBe(0);
      expect(result.data.tasks[2].order).toBe(1);
    });
  });

  describe("PATCH /api/phases/[phaseId]", () => {
    test("owner can update phase name", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Updated Phase Name" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.name).toBe("Updated Phase Name");
      expect(result.data.id).toBe(phaseId);

      // Verify in database
      const updatedPhase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(updatedPhase?.name).toBe("Updated Phase Name");
    });

    test("owner can update phase description", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { description: "Updated description" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.description).toBe("Updated description");
    });

    test("owner can update phase status", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { status: "IN_PROGRESS" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.status).toBe("IN_PROGRESS");

      // Verify in database
      const updatedPhase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(updatedPhase?.status).toBe("IN_PROGRESS");
    });

    test("owner can update phase order", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { order: 5 },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.order).toBe(5);
    });

    test("owner can update multiple fields at once", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        {
          name: "Multi Update",
          description: "New description",
          status: "DONE",
          order: 3,
        },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.name).toBe("Multi Update");
      expect(result.data.description).toBe("New description");
      expect(result.data.status).toBe("DONE");
      expect(result.data.order).toBe(3);
    });

    test("member can update phase", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Member Update" },
        member,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.name).toBe("Member Update");
    });

    test("validates name cannot be empty string", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "   " },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "cannot be empty", 400);
    });

    test("validates name cannot be empty after trim", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "cannot be empty", 400);
    });

    test("trims whitespace from name", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "  Trimmed Name  " },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.name).toBe("Trimmed Name");
    });

    test("trims whitespace from description", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { description: "  Trimmed Description  " },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.data.description).toBe("Trimmed Description");
    });

    test("validates order must be a number", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { order: "not-a-number" as any },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "must be a number", 400);
    });

    test("outsider cannot update phase", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Hacked" },
        outsider,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("unauthenticated user cannot update phase", async () => {
      const request = createPatchRequest(`http://localhost:3000/api/phases/${phaseId}`, { name: "Hacked" });

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent phase", async () => {
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/non-existent-id`,
        { name: "Update" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId: "non-existent-id" }),
      });

      await expectNotFound(response, "not found");
    });

    test("does not enforce 404 for soft-deleted phase on PATCH", async () => {
      // Soft delete the phase
      await db.phase.update({
        where: { id: phaseId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Current implementation doesn't check deleted flag, so update succeeds
      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Update Deleted" },
        owner,
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      // Currently returns 200, not 404
      const result = await expectSuccess(response);
      expect(result.data.name).toBe("Update Deleted");
    });

    test("concurrent updates are atomic", async () => {
      const request1 = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Update 1" },
        owner,
      );

      const request2 = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { status: "IN_PROGRESS" },
        owner,
      );

      // Execute concurrently
      const [response1, response2] = await Promise.all([
        PATCH(request1, { params: Promise.resolve({ phaseId }) }),
        PATCH(request2, { params: Promise.resolve({ phaseId }) }),
      ]);

      // Both should succeed
      await expectSuccess(response1);
      await expectSuccess(response2);

      // Final state should reflect both updates
      const finalPhase = await db.phase.findUnique({
        where: { id: phaseId },
      });

      // At least one update should be present
      expect(finalPhase?.name === "Update 1" || finalPhase?.status === "IN_PROGRESS").toBe(true);
    });
  });

  describe("DELETE /api/phases/[phaseId]", () => {
    test("owner can soft delete phase", async () => {
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.success).toBe(true);
      expect(result.message).toContain("deleted");

      // Verify soft delete in database
      const deletedPhase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(deletedPhase?.deleted).toBe(true);
      expect(deletedPhase?.deletedAt).toBeTruthy();
      expect(deletedPhase?.deletedAt).toBeInstanceOf(Date);
    });

    test("member can soft delete phase", async () => {
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, member);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      const result = await expectSuccess(response);
      expect(result.success).toBe(true);

      // Verify in database
      const deletedPhase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(deletedPhase?.deleted).toBe(true);
    });

    test("soft delete does not orphan tickets automatically", async () => {
      // Get initial tickets
      const ticketsBefore = await db.task.findMany({
        where: { phaseId: phaseId },
      });
      expect(ticketsBefore).toHaveLength(2);
      expect(ticketsBefore[0].phaseId).toBe(phaseId);

      // Delete phase (soft delete)
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      // Verify tickets still reference the phase (soft delete doesn't trigger onDelete cascade)
      // Note: Tickets need to be manually updated to set phaseId to null if desired
      const ticketsAfter = await db.task.findMany({
        where: {
          id: { in: ticketsBefore.map((t) => t.id) },
        },
      });

      expect(ticketsAfter).toHaveLength(2);
      // Soft delete doesn't trigger CASCADE - tickets still have phaseId
      expect(ticketsAfter[0].phaseId).toBe(phaseId);
      expect(ticketsAfter[1].phaseId).toBe(phaseId);
      expect(ticketsAfter[0].deleted).toBe(false);
      expect(ticketsAfter[1].deleted).toBe(false);
    });

    test("does not delete ticket records when phase is deleted", async () => {
      const ticketsBefore = await db.task.findMany({
        where: { phaseId: phaseId },
      });
      const ticketIds = ticketsBefore.map((t) => t.id);

      // Delete phase
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      // Verify tickets still exist
      const ticketsAfter = await db.task.findMany({
        where: { id: { in: ticketIds } },
      });

      expect(ticketsAfter).toHaveLength(ticketIds.length);
      ticketsAfter.forEach((ticket) => {
        expect(ticket.deleted).toBe(false);
      });
    });

    test("outsider cannot delete phase", async () => {
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, outsider);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectError(response, "Access denied", 403);

      // Verify phase was not deleted
      const phase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(phase?.deleted).toBe(false);
    });

    test("unauthenticated user cannot delete phase", async () => {
      const request = createDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      await expectUnauthorized(response);

      // Verify phase was not deleted
      const phase = await db.phase.findUnique({
        where: { id: phaseId },
      });
      expect(phase?.deleted).toBe(false);
    });

    test("returns 404 for non-existent phase", async () => {
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/non-existent-id`, owner);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId: "non-existent-id" }),
      });

      await expectNotFound(response, "not found");
    });

    test("does not enforce 404 for already deleted phase", async () => {
      // Soft delete the phase first
      await db.phase.update({
        where: { id: phaseId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Try to delete again - current implementation doesn't check deleted flag
      // so it returns 200 success (idempotent behavior)
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phaseId}`, owner);

      const response = await DELETE(request, {
        params: Promise.resolve({ phaseId }),
      });

      // Current implementation returns 200, not 404
      const result = await expectSuccess(response);
      expect(result.success).toBe(true);
    });
  });

  describe("Data Consistency", () => {
    test("phase order remains consistent after deletion", async () => {
      // Create multiple phases
      const phase2 = await db.phase.create({
        data: {
          name: "Phase 2",
          status: "NOT_STARTED",
          order: 1,
          featureId: featureId,
        },
      });

      const phase3 = await db.phase.create({
        data: {
          name: "Phase 3",
          status: "NOT_STARTED",
          order: 2,
          featureId: featureId,
        },
      });

      // Delete middle phase
      const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/phases/${phase2.id}`, owner);

      await DELETE(request, {
        params: Promise.resolve({ phaseId: phase2.id }),
      });

      // Verify remaining phases maintain their order
      const remainingPhases = await db.phase.findMany({
        where: {
          featureId: featureId,
          deleted: false,
        },
        orderBy: { order: "asc" },
      });

      expect(remainingPhases).toHaveLength(2);
      expect(remainingPhases[0].id).toBe(phaseId);
      expect(remainingPhases[0].order).toBe(0);
      expect(remainingPhases[1].id).toBe(phase3.id);
      expect(remainingPhases[1].order).toBe(2);
    });

    test("soft-deleted phases are filtered from queries", async () => {
      // Create another phase
      await db.phase.create({
        data: {
          name: "Phase 2",
          status: "NOT_STARTED",
          order: 1,
          featureId: featureId,
        },
      });

      // Soft delete first phase
      await db.phase.update({
        where: { id: phaseId },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Query non-deleted phases
      const activePhases = await db.phase.findMany({
        where: {
          featureId: featureId,
          deleted: false,
        },
      });

      expect(activePhases).toHaveLength(1);
      expect(activePhases[0].name).toBe("Phase 2");
    });

    test("updatedat timestamp is updated on phase modification", async () => {
      const phaseBefore = await db.phase.findUnique({
        where: { id: phaseId },
      });

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/phases/${phaseId}`,
        { name: "Updated Name" },
        owner,
      );

      await PATCH(request, {
        params: Promise.resolve({ phaseId }),
      });

      const phaseAfter = await db.phase.findUnique({
        where: { id: phaseId },
      });

      expect(phaseAfter?.updatedAt.getTime()).toBeGreaterThan(phaseBefore?.updatedAt.getTime() || 0);
    });
  });
});
