import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/phases/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectValidationError,
} from "@/__tests__/support/helpers/api-assertions";
import { createAuthenticatedPostRequest, createPostRequest } from "@/__tests__/support/helpers/request-builders";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

describe("POST /api/features/[featureId]/phases", () => {
  let owner: any;
  let member: any;
  let nonMember: any;
  let workspace: any;
  let feature: any;

  beforeEach(async () => {
    // Create test users
    owner = await createTestUser();
    member = await createTestUser();
    nonMember = await createTestUser();

    // Create workspace owned by owner
    workspace = await createTestWorkspace({ ownerId: owner.id });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      },
    });

    // Create test feature
    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  afterEach(async () => {
    // Cleanup: delete feature cascades to phases
    if (feature?.id) {
      await db.feature.deleteMany({ where: { id: feature.id } });
    }
    if (workspace?.id) {
      await db.workspace.deleteMany({ where: { id: workspace.id } });
    }
  });

  describe("Successful Phase Creation", () => {
    test("should create phase with valid data as workspace owner", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Planning Phase", description: "Initial planning" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      expect(data.data).toMatchObject({
        name: "Planning Phase",
        description: "Initial planning",
        featureId: feature.id,
        order: 0,
        status: "NOT_STARTED",
      });
      expect(data.data.id).toBeDefined();
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.updatedAt).toBeDefined();

      // Verify in database
      const phase = await db.phase.findUnique({ where: { id: data.data.id } });
      expect(phase).toBeTruthy();
      expect(phase?.featureId).toBe(feature.id);
      expect(phase?.name).toBe("Planning Phase");
      expect(phase?.description).toBe("Initial planning");
      expect(phase?.order).toBe(0);
    });

    test("should create phase as workspace member", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Development Phase" },
        member
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      expect(data.data.name).toBe("Development Phase");
      expect(data.data.featureId).toBe(feature.id);
      expect(response.status).toBe(201);
    });

    test("should create phase with name only (optional description)", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Testing Phase" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      expect(data.data.name).toBe("Testing Phase");
      expect(data.data.description).toBeNull();
    });

    test("should calculate correct order for multiple phases", async () => {
      // Create first phase
      const req1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const resp1 = await POST(req1, { params: Promise.resolve({ featureId: feature.id }) });
      const phase1 = await expectSuccess(resp1, 201);
      expect(phase1.data.order).toBe(0);

      // Create second phase
      const req2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const resp2 = await POST(req2, { params: Promise.resolve({ featureId: feature.id }) });
      const phase2 = await expectSuccess(resp2, 201);
      expect(phase2.data.order).toBe(1);

      // Create third phase
      const req3 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 3" },
        owner
      );
      const resp3 = await POST(req3, { params: Promise.resolve({ featureId: feature.id }) });
      const phase3 = await expectSuccess(resp3, 201);
      expect(phase3.data.order).toBe(2);
    });

    test("should trim name and description", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "  Trimmed Name  ", description: "  Trimmed Desc  " },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      expect(data.data.name).toBe("Trimmed Name");
      expect(data.data.description).toBe("Trimmed Desc");

      // Verify in database
      const phase = await db.phase.findUnique({ where: { id: data.data.id } });
      expect(phase?.name).toBe("Trimmed Name");
      expect(phase?.description).toBe("Trimmed Desc");
    });
  });

  describe("Authentication & Authorization", () => {
    test("should reject unauthorized user", async () => {
      const request = createPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      await expectUnauthorized(response);
    });

    test("should reject non-member access", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase" },
        nonMember
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      await expectForbidden(response);
    });

    test("should reject invalid feature ID", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/invalid-id/phases`,
        { name: "Phase" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "invalid-id" }) });
      await expectNotFound(response);
    });

    test("should reject access to deleted workspace feature", async () => {
      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      await expectNotFound(response);
    });
  });

  describe("Input Validation", () => {
    test("should validate required name field", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { description: "No name provided" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("required");
    });

    test("should reject empty name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("required");
    });

    test("should reject whitespace-only name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "   " },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("required");
    });

    test("should reject non-string name", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: 123 },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("required");
    });
  });

  describe("Database State Verification", () => {
    test("should persist phase with correct relationships", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Verification Phase", description: "Testing persistence" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      // Query phase with feature relationship
      const phase = await db.phase.findUnique({
        where: { id: data.data.id },
        include: { feature: true },
      });

      expect(phase).toBeTruthy();
      expect(phase?.featureId).toBe(feature.id);
      expect(phase?.feature.id).toBe(feature.id);
      expect(phase?.feature.workspaceId).toBe(workspace.id);
    });

    test("should cascade delete phases when feature is deleted", async () => {
      // Create two phases
      const req1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 1" },
        owner
      );
      const resp1 = await POST(req1, { params: Promise.resolve({ featureId: feature.id }) });
      const phase1 = await expectSuccess(resp1, 201);

      const req2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase 2" },
        owner
      );
      const resp2 = await POST(req2, { params: Promise.resolve({ featureId: feature.id }) });
      const phase2 = await expectSuccess(resp2, 201);

      // Verify phases exist
      const phasesBefore = await db.phase.findMany({
        where: { featureId: feature.id },
      });
      expect(phasesBefore).toHaveLength(2);

      // Delete feature (cascade delete should remove phases)
      await db.feature.delete({ where: { id: feature.id } });

      // Verify phases are deleted
      const phasesAfter = await db.phase.findMany({
        where: { featureId: feature.id },
      });
      expect(phasesAfter).toHaveLength(0);

      // Prevent cleanup from failing
      feature = null;
    });

    test("should return phase with task count", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Phase with Tasks" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      // Response should include _count.tasks even if zero
      expect(data.data._count).toBeDefined();
      expect(data.data._count.tasks).toBe(0);
    });
  });

  describe("Feature Association", () => {
    test("should correctly associate phase with feature", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Associated Phase" },
        owner
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
      const data = await expectSuccess(response, 201);

      // Response includes featureId
      expect(data.data.featureId).toBe(feature.id);

      // Database record has correct featureId
      const phase = await db.phase.findUnique({ where: { id: data.data.id } });
      expect(phase?.featureId).toBe(feature.id);
    });

    test("should create phases for different features independently", async () => {
      // Create second feature
      const feature2 = await db.feature.create({
        data: {
          title: "Second Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Create phase for first feature
      const req1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        { name: "Feature 1 Phase" },
        owner
      );
      const resp1 = await POST(req1, { params: Promise.resolve({ featureId: feature.id }) });
      const phase1 = await expectSuccess(resp1, 201);
      expect(phase1.data.featureId).toBe(feature.id);
      expect(phase1.data.order).toBe(0);

      // Create phase for second feature
      const req2 = createAuthenticatedPostRequest(
        `/api/features/${feature2.id}/phases`,
        { name: "Feature 2 Phase" },
        owner
      );
      const resp2 = await POST(req2, { params: Promise.resolve({ featureId: feature2.id }) });
      const phase2 = await expectSuccess(resp2, 201);
      expect(phase2.data.featureId).toBe(feature2.id);
      expect(phase2.data.order).toBe(0); // Order is independent per feature

      // Cleanup
      await db.feature.delete({ where: { id: feature2.id } });
    });
  });
});
