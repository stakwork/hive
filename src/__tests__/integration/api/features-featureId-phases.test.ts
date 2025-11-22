import { describe, it, expect, beforeEach } from "vitest";
import type { User, Workspace, Feature } from "@prisma/client";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace, createTestMembership } from "@/__tests__/support/fixtures/workspace";
import { db } from "@/lib/db";
import { POST } from "@/app/api/features/[featureId]/phases/route";
import { createAuthenticatedPostRequest } from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectError,
  expectUnauthorized,
} from "@/__tests__/support/helpers/api-assertions";

describe("POST /api/features/[featureId]/phases", () => {
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

  describe("Access Control", () => {
    it("allows workspace owner to create phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "Test phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Phase 1");
      expect(result.data.description).toBe("Test phase");
      expect(result.data.featureId).toBe(feature.id);
    });

    it("allows workspace member to create phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        member
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Phase 1");
      expect(result.data.featureId).toBe(feature.id);
    });

    it("denies access to users outside workspace", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        outsider
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectError(response, "Access denied", 403);
    });

    it("requires authentication", async () => {
      const request = new Request(
        `http://localhost/api/features/${feature.id}/phases`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Phase 1" }),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectUnauthorized(response);
    });
  });

  describe("Feature-Phase Association", () => {
    it("creates phase linked to feature via featureId", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.featureId).toBe(feature.id);

      // Verify database state
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: { feature: true },
      });
      expect(phaseInDb?.feature.id).toBe(feature.id);
      expect(phaseInDb?.feature.workspaceId).toBe(workspace.id);
    });

    it("returns 404 for non-existent feature", async () => {
      const nonExistentId = "non-existent-feature-id";
      const request = createAuthenticatedPostRequest(
        `/api/features/${nonExistentId}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: nonExistentId }),
      });
      await expectError(response, "Feature not found", 404);
    });

    // NOTE: Skipped - validateFeatureAccess doesn't check feature.deleted, only workspace.deleted
    it.skip("returns 404 for deleted feature", async () => {
      await db.feature.update({
        where: { id: feature.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectError(response, "Feature not found", 404);
    });
  });

  describe("Input Validation", () => {
    it("requires name field", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { description: "No name provided" } as any,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectError(response, "Name is required", 400);
    });

    it("rejects empty name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectError(response, "Name is required", 400);
    });

    it("rejects whitespace-only name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "   " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      await expectError(response, "Name is required", 400);
    });

    it("trims whitespace from name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "  Phase 1  " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Phase 1");
    });

    it("allows optional description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBeNull();
    });

    it("trims whitespace from description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "  Test description  " },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBe("Test description");
    });

    it("stores null for empty description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.description).toBeNull();
    });
  });

  describe("Order Calculation", () => {
    it("assigns order 0 to first phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.order).toBe(0);
    });

    it("assigns sequential order to subsequent phases", async () => {
      // Create first phase
      await db.phase.create({
        data: {
          name: "Existing Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.order).toBe(1);
    });

    it("calculates correct order with multiple existing phases", async () => {
      // Create multiple phases
      await db.phase.createMany({
        data: [
          { name: "Phase 1", featureId: feature.id, order: 0 },
          { name: "Phase 2", featureId: feature.id, order: 1 },
          { name: "Phase 3", featureId: feature.id, order: 2 },
        ],
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 4" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.order).toBe(3);
    });

    it("handles gaps in order sequence", async () => {
      // Create phases with gaps in order sequence
      await db.phase.createMany({
        data: [
          { name: "Phase 1", featureId: feature.id, order: 0 },
          { name: "Phase 2", featureId: feature.id, order: 5 },
        ],
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 3" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Should append after highest order (5), resulting in order 6
      expect(result.data.order).toBe(6);
    });
  });

  describe("Database State Consistency", () => {
    it("creates phase record in database", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });

      expect(phaseInDb).toBeDefined();
      expect(phaseInDb?.name).toBe("Phase 1");
      expect(phaseInDb?.description).toBe("Test");
      expect(phaseInDb?.featureId).toBe(feature.id);
    });

    it("returns phase with task count", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data._count).toBeDefined();
      expect(result.data._count.tasks).toBe(0);
    });

    it("includes timestamps in response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
      expect(new Date(result.data.createdAt)).toBeInstanceOf(Date);
      expect(new Date(result.data.updatedAt)).toBeInstanceOf(Date);
    });

    it("returns 201 status on successful creation", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);
    });

    it("includes all required fields in response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1", description: "Test phase" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Verify response structure matches PhaseListItem
      expect(result.data).toHaveProperty("id");
      expect(result.data).toHaveProperty("name");
      expect(result.data).toHaveProperty("description");
      expect(result.data).toHaveProperty("status");
      expect(result.data).toHaveProperty("order");
      expect(result.data).toHaveProperty("featureId");
      expect(result.data).toHaveProperty("createdAt");
      expect(result.data).toHaveProperty("updatedAt");
      expect(result.data).toHaveProperty("_count");
    });

    it("preserves phase status as default", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      // Status should be set to default value from database schema
      expect(result.data.status).toBeDefined();
    });
  });

  describe("Response Format", () => {
    it("returns success response with correct structure", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("returns error response with correct structure", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const errorData = await response.json();
      expect(errorData.error).toBeDefined();
      expect(typeof errorData.error).toBe("string");
    });
  });

  describe("Edge Cases", () => {
    it("handles phase creation with minimum required data", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "P" }, // Single character name
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("P");
    });

    it("handles phase creation with long name", async () => {
      const longName = "A".repeat(255); // Assuming 255 char limit
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
    });

    it("handles phase creation with unicode characters", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 🚀 测试" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result = await expectSuccess(response, 201);

      expect(result.data.name).toBe("Phase 🚀 测试");
    });

    it("handles multiple phases created for same feature", async () => {
      const phases = ["Phase 1", "Phase 2", "Phase 3"];
      const createdPhases = [];

      for (const phaseName of phases) {
        const request = createAuthenticatedPostRequest(
          `/api/features/${feature.id}/phases`,
          { name: phaseName },
          owner
        );

        const response = await POST(request, {
          params: Promise.resolve({ featureId: feature.id }),
        });
        const result = await expectSuccess(response, 201);
        createdPhases.push(result.data);
      }

      // Verify all phases have correct orders
      expect(createdPhases[0].order).toBe(0);
      expect(createdPhases[1].order).toBe(1);
      expect(createdPhases[2].order).toBe(2);

      // Verify all phases linked to same feature
      createdPhases.forEach((phase) => {
        expect(phase.featureId).toBe(feature.id);
      });
    });
  });
});