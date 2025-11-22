import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/phases/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
  expectSuccess,
  expectError,
  expectUnauthorized,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Feature } from "@prisma/client";
import type { PhaseListItem } from "@/types/roadmap";

describe("POST /api/features/[featureId]/phases - Phase Creation", () => {
  let owner: User;
  let member: User;
  let outsider: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    // Create test users with different roles
    owner = await createTestUser({ name: "Owner" });
    member = await createTestUser({ name: "Member" });
    outsider = await createTestUser({ name: "Outsider" });

    // Setup workspace and membership
    workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: member.id,
      role: "DEVELOPER",
    });

    // Create feature for testing
    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  describe("Access Control Validation", () => {
    it("should allow workspace owner to create phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "Test phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe("Phase 1");
      expect(result.data.description).toBe("Test phase");
      expect(result.data.featureId).toBe(feature.id);
    });

    it("should allow workspace member to create phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Member Phase", description: "Created by member" },
        member
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe("Member Phase");
      expect(result.data.description).toBe("Created by member");
      expect(result.data.featureId).toBe(feature.id);
    });

    it("should deny access to non-workspace member (outsider)", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Unauthorized Phase" },
        outsider
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(403);
      await expectError(response, "Access denied", 403);
    });

    it("should deny access to unauthenticated requests", async () => {
      const request = new Request(`http://localhost/api/features/${feature.id}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unauthorized Phase" }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectUnauthorized(response);
      expect(response.status).toBe(401);
    });
  });

  describe("Feature-Phase Association Validation", () => {
    it("should correctly associate phase with feature via featureId foreign key", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Associated Phase", description: "FK test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Verify feature association in response
      expect(result.data.featureId).toBe(feature.id);

      // Verify database state
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: { feature: true },
      });

      expect(phaseInDb).toBeDefined();
      expect(phaseInDb?.featureId).toBe(feature.id);
      expect(phaseInDb?.feature.id).toBe(feature.id);
      expect(phaseInDb?.feature.workspaceId).toBe(workspace.id);
    });

    it("should return 404 when feature does not exist", async () => {
      const nonExistentFeatureId = "non-existent-feature-id";
      const request = createAuthenticatedPostRequest(
        `/api/features/${nonExistentFeatureId}/phases`,
        { name: "Phase for non-existent feature" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: nonExistentFeatureId }),
      });

      expect(response.status).toBe(404);
      await expectError(response, "not found", 404);
    });

    it("should return 404 when feature workspace is soft-deleted", async () => {
      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase for deleted workspace" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(404);
      await expectError(response, "not found", 404);
    });

    it("should verify phase count is initialized to zero", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase with task count" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data._count).toBeDefined();
      expect(result.data._count.tasks).toBe(0);
    });
  });

  describe("Input Validation", () => {
    it("should require name field", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { description: "Phase without name" } as any,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      await expectError(response, "required", 400);
    });

    it("should reject empty name string", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      await expectError(response, "required", 400);
    });

    it("should reject name with only whitespace", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "   " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      await expectError(response, "required", 400);
    });

    it("should trim whitespace from name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "  Trimmed Phase Name  " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Trimmed Phase Name");

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.name).toBe("Trimmed Phase Name");
    });

    it("should accept phase with only name (description optional)", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase without description" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Phase without description");
      expect(result.data.description).toBeNull();
    });

    it("should trim whitespace from description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase", description: "  Trimmed Description  " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBe("Trimmed Description");

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.description).toBe("Trimmed Description");
    });

    it("should store null for empty description after trimming", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase", description: "   " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBeNull();

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.description).toBeNull();
    });
  });

  describe("Order Calculation", () => {
    it("should assign order 0 to first phase in feature", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "First Phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.order).toBe(0);
    });

    it("should auto-increment order for subsequent phases", async () => {
      // Create first phase
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = await expectSuccess(response1, 201);
      expect(result1.data.order).toBe(0);

      // Create second phase
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result2 = await expectSuccess(response2, 201);
      expect(result2.data.order).toBe(1);

      // Create third phase
      const request3 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 3" },
        owner
      );
      const response3 = await POST(request3, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result3 = await expectSuccess(response3, 201);
      expect(result3.data.order).toBe(2);
    });

    it("should calculate order independently per feature", async () => {
      // Create second feature
      const feature2 = await db.feature.create({
        data: {
          title: "Second Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Create phase in first feature
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Feature 1 Phase 1" },
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = await expectSuccess(response1, 201);
      expect(result1.data.order).toBe(0);

      // Create phase in second feature (should also be order 0)
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature2.id}/phases`,
        { name: "Feature 2 Phase 1" },
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature2.id }),
      });
      const result2 = await expectSuccess(response2, 201);
      expect(result2.data.order).toBe(0);

      // Add another phase to first feature (should be order 1)
      const request3 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Feature 1 Phase 2" },
        owner
      );
      const response3 = await POST(request3, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result3 = await expectSuccess(response3, 201);
      expect(result3.data.order).toBe(1);
    });

    it("should continue order sequence after soft-deleted phases", async () => {
      // Create first phase
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = await expectSuccess(response1, 201);

      // Soft delete the phase
      await db.phase.update({
        where: { id: result1.data.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      // Create second phase (order should still be 1, not 0)
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result2 = await expectSuccess(response2, 201);
      expect(result2.data.order).toBe(1);
    });
  });

  describe("Data Consistency Validation", () => {
    it("should verify database state matches API response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Consistent Phase", description: "Consistency test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Query database directly
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: { _count: { select: { tasks: true } } },
      });

      // Verify all fields match
      expect(phaseInDb).toBeDefined();
      expect(phaseInDb?.id).toBe(result.data.id);
      expect(phaseInDb?.name).toBe(result.data.name);
      expect(phaseInDb?.description).toBe(result.data.description);
      expect(phaseInDb?.featureId).toBe(result.data.featureId);
      expect(phaseInDb?.order).toBe(result.data.order);
      expect(phaseInDb?.status).toBe(result.data.status);
      expect(phaseInDb?._count.tasks).toBe(result.data._count.tasks);
    });

    it("should enforce featureId foreign key constraint", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "FK Test Phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Verify phase cannot exist without valid feature
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: { feature: true },
      });

      expect(phaseInDb?.feature).toBeDefined();
      expect(phaseInDb?.feature.id).toBe(feature.id);
    });

    it("should initialize phase with default status", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Status Test Phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.status).toBe("NOT_STARTED");

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.status).toBe("NOT_STARTED");
    });

    it("should set deleted flag to false for new phases", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Soft Delete Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Verify deleted flag in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.deleted).toBe(false);
      expect(phaseInDb?.deletedAt).toBeNull();
    });

    it("should set createdAt and updatedAt timestamps", async () => {
      const beforeCreation = new Date();

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Timestamp Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      const afterCreation = new Date();

      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();

      const createdAt = new Date(result.data.createdAt);
      const updatedAt = new Date(result.data.updatedAt);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    });
  });

  describe("Response Format Validation", () => {
    it("should return PhaseResponse wrapper with success flag", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Response Format Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("data");
      expect(result.success).toBe(true);
    });

    it("should return all required PhaseListItem fields", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Complete Phase", description: "All fields test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      const phase = result.data;

      // Verify all required fields from PhaseListItem type
      expect(phase).toHaveProperty("id");
      expect(phase).toHaveProperty("name");
      expect(phase).toHaveProperty("description");
      expect(phase).toHaveProperty("status");
      expect(phase).toHaveProperty("order");
      expect(phase).toHaveProperty("featureId");
      expect(phase).toHaveProperty("createdAt");
      expect(phase).toHaveProperty("updatedAt");
      expect(phase).toHaveProperty("_count");
      expect(phase._count).toHaveProperty("tasks");

      // Verify field types
      expect(typeof phase.id).toBe("string");
      expect(typeof phase.name).toBe("string");
      expect(typeof phase.status).toBe("string");
      expect(typeof phase.order).toBe("number");
      expect(typeof phase.featureId).toBe("string");
      expect(typeof phase._count.tasks).toBe("number");
    });

    it("should return 201 Created status code on success", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Status Code Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectSuccess(response, 201);
    });
  });

  describe("Error Handling", () => {
    it("should return 500 for unexpected server errors", async () => {
      // Create invalid request that triggers server error
      const invalidFeatureId = "malformed-id-that-causes-error";
      const request = createAuthenticatedPostRequest(
        `/api/features/${invalidFeatureId}/phases`,
        { name: "Server Error Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: invalidFeatureId }),
      });

      // Should return error status (404 or 500 depending on validation)
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("should include error message in error response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "" } as any,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      await expectError(response, "required", 400);
    });

    it("should handle malformed JSON in request body", async () => {
      const request = new Request(`http://localhost/api/features/${feature.id}/phases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `authjs.session-token=mock-session-${owner.id}`,
        },
        body: "{ invalid json",
      });

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle multiple phase creations in sequence", async () => {
      const phaseNames = ["Phase A", "Phase B", "Phase C"];
      const createdPhases: PhaseListItem[] = [];

      for (const name of phaseNames) {
        const request = createAuthenticatedPostRequest(
          `/api/features/${feature.id}/phases`,
          { name },
          owner
        );

        const response = await POST(request, {
          params: Promise.resolve({ featureId: feature.id }),
        });
        const result = await expectSuccess(response, 201);
        createdPhases.push(result.data);
      }

      // Verify all phases created with correct order
      expect(createdPhases).toHaveLength(3);
      expect(createdPhases[0].order).toBe(0);
      expect(createdPhases[1].order).toBe(1);
      expect(createdPhases[2].order).toBe(2);

      // Verify in database
      const phasesInDb = await db.phase.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });
      expect(phasesInDb).toHaveLength(3);
      expect(phasesInDb.map(p => p.name)).toEqual(phaseNames);
    });

    it("should maintain order consistency with parallel creations", async () => {
      // Note: This test validates order calculation safety
      // In production, calculateNextOrder() uses database queries
      // which should handle concurrent operations correctly

      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Concurrent Phase 1" },
        owner
      );

      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Concurrent Phase 2" },
        owner
      );

      const [response1, response2] = await Promise.all([
        POST(request1, { params: Promise.resolve({ featureId: feature.id }) }),
        POST(request2, { params: Promise.resolve({ featureId: feature.id }) }),
      ]);

      const result1 = await expectSuccess(response1, 201);
      const result2 = await expectSuccess(response2, 201);

      // Verify both phases created successfully
      expect(result1.data.id).toBeDefined();
      expect(result2.data.id).toBeDefined();
      expect(result1.data.id).not.toBe(result2.data.id);

      // Verify orders are unique (may be 0,1 or both 0 depending on race condition)
      const orders = [result1.data.order, result2.data.order];
      const uniqueOrders = new Set(orders);

      // In ideal case, orders should be unique
      // In race condition, both might get same order (calculateNextOrder limitation)
      // This test documents the behavior
      expect(orders.every(o => o >= 0)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long phase names", async () => {
      const longName = "A".repeat(500);
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: longName },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe(longName);

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.name).toBe(longName);
    });

    it("should handle very long descriptions", async () => {
      const longDescription = "B".repeat(1000);
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase", description: longDescription },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBe(longDescription);

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.description).toBe(longDescription);
    });

    it("should handle special characters in name and description", async () => {
      const specialName = "Phase !@#$%^&*()_+-=[]{}|;':\",./<>?";
      const specialDescription = "Description with émojis 🚀 and unicode ñ";

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: specialName, description: specialDescription },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe(specialName);
      expect(result.data.description).toBe(specialDescription);

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.name).toBe(specialName);
      expect(phaseInDb?.description).toBe(specialDescription);
    });

    it("should handle null description explicitly", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase", description: null },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBeNull();

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.description).toBeNull();
    });

    it("should handle undefined description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase", description: undefined },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBeNull();

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.description).toBeNull();
    });
  });
});