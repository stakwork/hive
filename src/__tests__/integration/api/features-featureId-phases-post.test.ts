import { describe, test, beforeEach, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/features/[featureId]/phases/route";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createAuthenticatedPostRequest } from "@/__tests__/support/helpers/request-builders";
import { db } from "@/lib/db";
import type { User, Workspace, Feature } from "@prisma/client";
import type { CreatePhaseRequest, PhaseResponse } from "@/types/roadmap";

describe("POST /api/features/[featureId]/phases", () => {
  let owner: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    await resetDatabase();

    // Create test fixtures
    owner = await createTestUser({ name: "Test Owner" });
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      ownerId: owner.id,
    });

    // Create a test feature
    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  describe("Happy Path", () => {
    test("creates phase with valid data and returns 201", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Phase 1",
        description: "Test phase description",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as PhaseResponse;
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe("Phase 1");
      expect(result.data.description).toBe("Test phase description");
      expect(result.data.featureId).toBe(feature.id);
      expect(result.data.status).toBe("NOT_STARTED");
      expect(result.data.order).toBe(0);
      expect(result.data._count.tasks).toBe(0);
    });

    test("creates phase with minimal data (name only)", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Minimal Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.name).toBe("Minimal Phase");
      expect(result.data.description).toBeNull();
    });

    test("persists phase to database with correct relationships", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Database Test Phase",
        description: "Verify persistence",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;
      const phaseId = result.data.id;

      // Verify phase exists in database
      const dbPhase = await db.phase.findUnique({
        where: { id: phaseId },
        include: { feature: true },
      });

      expect(dbPhase).toBeDefined();
      expect(dbPhase?.name).toBe("Database Test Phase");
      expect(dbPhase?.description).toBe("Verify persistence");
      expect(dbPhase?.featureId).toBe(feature.id);
      expect(dbPhase?.feature.id).toBe(feature.id);
      expect(dbPhase?.deleted).toBe(false);
    });
  });

  describe("Order Calculation", () => {
    test("assigns order 0 to first phase", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "First Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.order).toBe(0);
    });

    test("assigns sequential order to multiple phases", async () => {
      // Create first phase
      const phase1Data: CreatePhaseRequest = { name: "Phase 1" };
      const request1 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phase1Data,
        owner
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result1 = (await response1.json()) as PhaseResponse;

      // Create second phase
      const phase2Data: CreatePhaseRequest = { name: "Phase 2" };
      const request2 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phase2Data,
        owner
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result2 = (await response2.json()) as PhaseResponse;

      // Create third phase
      const phase3Data: CreatePhaseRequest = { name: "Phase 3" };
      const request3 = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phase3Data,
        owner
      );
      const response3 = await POST(request3, {
        params: Promise.resolve({ featureId: feature.id }),
      });
      const result3 = (await response3.json()) as PhaseResponse;

      expect(result1.data.order).toBe(0);
      expect(result2.data.order).toBe(1);
      expect(result3.data.order).toBe(2);
    });

    test("calculates next order correctly when phases deleted", async () => {
      // Create three phases
      const phase1 = await db.phase.create({
        data: {
          name: "Phase 1",
          featureId: feature.id,
          order: 0,
        },
      });

      await db.phase.create({
        data: {
          name: "Phase 2",
          featureId: feature.id,
          order: 1,
        },
      });

      const phase3 = await db.phase.create({
        data: {
          name: "Phase 3",
          featureId: feature.id,
          order: 2,
        },
      });

      // Soft delete middle phase
      await db.phase.update({
        where: { id: phase1.id },
        data: { deleted: true },
      });

      // Create new phase - should get order 3 (max existing order + 1)
      const newPhaseData: CreatePhaseRequest = { name: "Phase 4" };
      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        newPhaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.order).toBe(3);
    });
  });

  describe("Input Validation", () => {
    test("rejects request with missing name", async () => {
      const phaseData = {
        description: "No name provided",
      } as CreatePhaseRequest;

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result.error).toContain("required");
    });

    test("rejects request with empty name", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result.error).toContain("required");
    });

    test("rejects request with whitespace-only name", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "   ",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result.error).toContain("required");
    });

    test("trims whitespace from name", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "  Trimmed Phase  ",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.name).toBe("Trimmed Phase");
    });

    test("trims whitespace from description", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Phase",
        description: "  Trimmed Description  ",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.description).toBe("Trimmed Description");
    });

    test("stores null for empty description", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Phase",
        description: "",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);

      const result = (await response.json()) as PhaseResponse;
      expect(result.data.description).toBeNull();
    });
  });

  describe("Authorization", () => {
    test("rejects unauthenticated request with 401", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Unauthorized Phase",
      };

      const request = new NextRequest(
        `http://localhost:3000/api/features/${feature.id}/phases`,
        {
          method: "POST",
          body: JSON.stringify(phaseData),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(401);

      const result = await response.json();
      expect(result.error).toBeDefined();
    });

    test("allows workspace member to create phase", async () => {
      const member = await createTestUser({ name: "Workspace Member" });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      const phaseData: CreatePhaseRequest = {
        name: "Member Created Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        member
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(201);
    });

    test("rejects non-member with 403", async () => {
      const nonMember = await createTestUser({ name: "Non Member" });

      const phaseData: CreatePhaseRequest = {
        name: "Forbidden Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        nonMember
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(403);

      const result = await response.json();
      expect(result.error).toContain("denied");
    });

    test("returns 404 for non-existent feature", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Orphan Phase",
      };

      const fakeFeatureId = "fake-feature-id";
      const request = createAuthenticatedPostRequest(
        `/api/features/${fakeFeatureId}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: fakeFeatureId }),
      });

      expect(response.status).toBe(404);

      const result = await response.json();
      expect(result.error).toContain("not found");
    });

    test("returns 404 for deleted workspace", async () => {
      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      const phaseData: CreatePhaseRequest = {
        name: "Deleted Workspace Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(404);

      const result = await response.json();
      expect(result.error).toContain("not found");
    });
  });

  describe("Feature Linking", () => {
    test("establishes correct foreign key relationship", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Linked Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      // Verify featureId is correct
      expect(result.data.featureId).toBe(feature.id);

      // Verify relationship in database
      const dbPhase = await db.phase.findUnique({
        where: { id: result.data.id },
        include: {
          feature: {
            include: {
              workspace: true,
            },
          },
        },
      });

      expect(dbPhase?.feature.id).toBe(feature.id);
      expect(dbPhase?.feature.title).toBe("Test Feature");
      expect(dbPhase?.feature.workspaceId).toBe(workspace.id);
      expect(dbPhase?.feature.workspace.id).toBe(workspace.id);
    });

    test("phase is retrievable through feature relationship", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Reverse Lookup Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      // Query feature to get phases
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
      expect(featureWithPhases?.phases[0].name).toBe("Reverse Lookup Phase");
    });
  });

  describe("Data Integrity", () => {
    test("applies default values correctly", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Default Values Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      // Verify defaults in response
      expect(result.data.status).toBe("NOT_STARTED");
      expect(result.data.order).toBeDefined();
      expect(result.data._count.tasks).toBe(0);

      // Verify defaults in database
      const dbPhase = await db.phase.findUnique({
        where: { id: result.data.id },
      });

      expect(dbPhase?.deleted).toBe(false);
      expect(dbPhase?.status).toBe("NOT_STARTED");
    });

    test("includes timestamps in response", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Timestamp Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
      expect(new Date(result.data.createdAt).getTime()).toBeLessThanOrEqual(
        Date.now()
      );
    });

    test("includes task count in response", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Task Count Phase",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      expect(result.data._count).toBeDefined();
      expect(result.data._count.tasks).toBe(0);

      // Create a task in the phase and verify count updates
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          phaseId: result.data.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Verify task is linked to phase
      const updatedPhase = await db.phase.findUnique({
        where: { id: result.data.id },
        select: {
          _count: {
            select: { tasks: true },
          },
        },
      });

      expect(updatedPhase?._count.tasks).toBe(1);
    });

    test("phase cannot be created without valid feature", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Orphan Phase",
      };

      const invalidFeatureId = "invalid-feature-id-12345";
      const request = createAuthenticatedPostRequest(
        `/api/features/${invalidFeatureId}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: invalidFeatureId }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Response Structure", () => {
    test("returns correct response structure on success", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "Response Structure Phase",
        description: "Testing response format",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = (await response.json()) as PhaseResponse;

      // Verify response structure
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("data");
      expect(result.success).toBe(true);

      // Verify data structure
      const { data } = result;
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("description");
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("order");
      expect(data).toHaveProperty("featureId");
      expect(data).toHaveProperty("createdAt");
      expect(data).toHaveProperty("updatedAt");
      expect(data).toHaveProperty("_count");
      expect(data._count).toHaveProperty("tasks");
    });

    test("returns correct error structure on failure", async () => {
      const phaseData: CreatePhaseRequest = {
        name: "",
      };

      const request = createAuthenticatedPostRequest(
        `/api/features/${feature.id}/phases`,
        phaseData,
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const result = await response.json();

      expect(result).toHaveProperty("error");
      expect(typeof result.error).toBe("string");
    });
  });
});