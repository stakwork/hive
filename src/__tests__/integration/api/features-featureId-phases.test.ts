import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/phases/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
  expectSuccess,
  expectError,
  expectUnauthorized,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Feature } from "@prisma/client";
import type { PhaseResponse } from "@/types/roadmap";

describe("POST /api/features/[featureId]/phases", () => {
  let owner: User;
  let member: User;
  let outsider: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    // Create test users with different roles
    owner = await createTestUser({ name: "Owner User" });
    member = await createTestUser({ name: "Member User" });
    outsider = await createTestUser({ name: "Outsider User" });

    // Create workspace owned by owner
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
    });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      },
    });

    // Create feature in workspace
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
        {
          name: "Phase 1",
          description: "First phase of the feature",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data).toMatchObject({
        name: "Phase 1",
        description: "First phase of the feature",
        featureId: feature.id,
        order: 0,
      });
      expect(result.data.id).toBeDefined();
      expect(result.data.createdAt).toBeDefined();
    });

    it("allows workspace member to create phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Member Phase",
          description: "Phase created by member",
        },
        member
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data).toMatchObject({
        name: "Member Phase",
        description: "Phase created by member",
        featureId: feature.id,
      });
    });

    it("rejects unauthenticated user with 401", async () => {
      const request = new Request(
        `http://localhost/api/features/${feature.id}/phases`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Unauthorized Phase",
          }),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectUnauthorized(response);
    });

    it("rejects user not in workspace with 403", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Outsider Phase",
        },
        outsider
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    it("returns 404 for non-existent feature", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      const request = createAuthenticatedPostRequest(
        `/api/features/${nonExistentId}/phases`,
        {
          name: "Phase for non-existent feature",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: nonExistentId }),
      });

      await expectError(response, "Feature not found", 404);
    });

    it("returns 404 when workspace is soft-deleted", async () => {
      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase for deleted workspace",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Feature not found", 404);
    });
  });

  describe("Feature-Phase Association", () => {
    it("creates phase with correct featureId foreign key", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Associated Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Verify featureId in response
      expect(result.data.featureId).toBe(feature.id);

      // Verify database record has correct foreign key
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: { feature: true },
      });

      expect(phaseInDb).toBeDefined();
      expect(phaseInDb?.featureId).toBe(feature.id);
      expect(phaseInDb?.feature.id).toBe(feature.id);
      expect(phaseInDb?.feature.workspaceId).toBe(workspace.id);
    });

    it("phase is queryable via feature relationship", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Queryable Phase",
          description: "Should be accessible via feature",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Query feature and verify phase is included
      const featureWithPhases = await db.feature.findUnique({
        where: { id: feature.id },
        include: {
          phases: {
            where: { deleted: false },
          },
        },
      });

      expect(featureWithPhases?.phases).toHaveLength(1);
      expect(featureWithPhases?.phases[0].id).toBe(result.data.id);
      expect(featureWithPhases?.phases[0].name).toBe("Queryable Phase");
    });

    it("multiple phases can be created for same feature", async () => {
      // Create first phase
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = await expectSuccess<PhaseResponse>(response1, 201);

      // Create second phase
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result2 = await expectSuccess<PhaseResponse>(response2, 201);

      // Verify both phases exist with correct featureId
      const phases = await db.phase.findMany({
        where: { featureId: feature.id, deleted: false },
        orderBy: { order: "asc" },
      });

      expect(phases).toHaveLength(2);
      expect(phases[0].id).toBe(result1.data.id);
      expect(phases[1].id).toBe(result2.data.id);
      expect(phases[0].featureId).toBe(feature.id);
      expect(phases[1].featureId).toBe(feature.id);
    });
  });

  describe("Input Validation", () => {
    it("requires name field", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          description: "Phase without name",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Name is required", 400);
    });

    it("rejects empty string name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "",
        },
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
        {
          name: "   ",
        },
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
        {
          name: "  Trimmed Phase  ",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data.name).toBe("Trimmed Phase");

      // Verify in database
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.name).toBe("Trimmed Phase");
    });

    it("allows optional description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase without description",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data.description).toBeNull();
    });

    it("trims whitespace from description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase with trimmed description",
          description: "  Description with spaces  ",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data.description).toBe("Description with spaces");
    });

    it("stores null for empty description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase with empty description",
          description: "",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data.description).toBeNull();
    });
  });

  describe("Order Calculation", () => {
    it("assigns order 0 to first phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "First Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.data.order).toBe(0);
    });

    it("increments order for subsequent phases", async () => {
      // Create first phase
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = await expectSuccess<PhaseResponse>(response1, 201);

      // Create second phase
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result2 = await expectSuccess<PhaseResponse>(response2, 201);

      // Create third phase
      const request3 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 3" },
        owner
      );
      const response3 = await POST(request3, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result3 = await expectSuccess<PhaseResponse>(response3, 201);

      expect(result1.data.order).toBe(0);
      expect(result2.data.order).toBe(1);
      expect(result3.data.order).toBe(2);
    });

    it("appends to end when existing phases have non-sequential orders", async () => {
      // Create phases with custom orders
      await db.phase.createMany({
        data: [
          {
            name: "Existing Phase 1",
            featureId: feature.id,
            order: 5,
          },
          {
            name: "Existing Phase 2",
            featureId: feature.id,
            order: 10,
          },
        ],
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "New Appended Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Should be max(10) + 1 = 11
      expect(result.data.order).toBe(11);
    });

    it("handles soft-deleted phases correctly in order calculation", async () => {
      // Create and soft-delete a phase
      const deletedPhase = await db.phase.create({
        data: {
          name: "Deleted Phase",
          featureId: feature.id,
          order: 0,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Create new phase - should still start at order 0
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "New Phase After Deletion",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Deleted phases are still counted in order calculation
      expect(result.data.order).toBe(1);
    });
  });

  describe("Database Consistency", () => {
    it("creates phase record that matches response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Consistent Phase",
          description: "Database should match response",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Query database to verify
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
        include: {
          _count: {
            select: { tasks: true },
          },
        },
      });

      expect(phaseInDb).toBeDefined();
      expect(phaseInDb).toMatchObject({
        id: result.data.id,
        name: result.data.name,
        description: result.data.description,
        featureId: result.data.featureId,
        order: result.data.order,
        status: result.data.status,
        deleted: false,
      });
      expect(phaseInDb?.createdAt.toISOString()).toEqual(result.data.createdAt);
      expect(phaseInDb?.updatedAt.toISOString()).toEqual(result.data.updatedAt);
    });

    it("initializes phase with default status", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase with default status",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Verify default status (should be DRAFT based on schema)
      expect(result.data.status).toBeDefined();
      
      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });
      expect(phaseInDb?.status).toBe(result.data.status);
    });

    it("initializes with deleted=false", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Non-deleted Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      const phaseInDb = await db.phase.findUnique({
        where: { id: result.data.id },
      });

      expect(phaseInDb?.deleted).toBe(false);
      expect(phaseInDb?.deletedAt).toBeNull();
    });

    it("returns task count of 0 for new phase", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase with no tasks",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // PhaseListItem includes _count: { tasks: number }
      expect(result.data._count).toBeDefined();
      expect(result.data._count.tasks).toBe(0);
    });

    it("sets timestamps correctly", async () => {
      const beforeCreation = new Date();

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Phase with timestamps",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);
      const afterCreation = new Date();

      // Verify timestamps are within expected range
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();

      const createdAt = new Date(result.data.createdAt);
      const updatedAt = new Date(result.data.updatedAt);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());

      // createdAt and updatedAt should be the same for new records
      expect(createdAt.getTime()).toBe(updatedAt.getTime());
    });
  });

  describe("Response Format", () => {
    it("returns 201 status on successful creation", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Successful Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);
    });

    it("returns PhaseResponse with success=true", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Response Phase",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("includes all PhaseListItem fields in response", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        {
          name: "Complete Phase",
          description: "Phase with all fields",
        },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await expectSuccess<PhaseResponse>(response, 201);

      // Verify all PhaseListItem fields are present
      expect(result.data).toHaveProperty("id");
      expect(result.data).toHaveProperty("name");
      expect(result.data).toHaveProperty("description");
      expect(result.data).toHaveProperty("status");
      expect(result.data).toHaveProperty("order");
      expect(result.data).toHaveProperty("featureId");
      expect(result.data).toHaveProperty("createdAt");
      expect(result.data).toHaveProperty("updatedAt");
      expect(result.data).toHaveProperty("_count");
      expect(result.data._count).toHaveProperty("tasks");
    });
  });
});