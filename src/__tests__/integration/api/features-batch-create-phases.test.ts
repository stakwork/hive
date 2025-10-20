import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/phases/batch-create/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";

describe("Batch Create Phases and Tickets API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/features/[featureId]/phases/batch-create", () => {
    test("creates phases and tickets successfully with real database operations", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Voice Commands Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phasesData = {
        phases: [
          {
            name: "Foundation",
            description: "Setup infrastructure",
            tickets: [
              {
                title: "Setup database schema",
                description: "Create tables for voice commands",
                priority: "HIGH" as const,
                tempId: "T1",
                dependsOn: [],
              },
              {
                title: "Build API endpoints",
                description: "REST API for voice processing",
                priority: "MEDIUM" as const,
                tempId: "T2",
                dependsOn: ["T1"],
              },
            ],
          },
          {
            name: "Core Features",
            description: "Implement main functionality",
            tickets: [
              {
                title: "Implement voice recognition",
                priority: "HIGH" as const,
                tempId: "T3",
                dependsOn: ["T1", "T2"],
              },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.data).toHaveLength(2);

      // Verify phase structure
      const phase1 = data.data[0];
      expect(phase1.phase.name).toBe("Foundation");
      expect(phase1.phase.description).toBe("Setup infrastructure");
      expect(phase1.phase.order).toBe(0);
      expect(phase1.tickets).toHaveLength(2);

      const phase2 = data.data[1];
      expect(phase2.phase.name).toBe("Core Features");
      expect(phase2.phase.order).toBe(1);
      expect(phase2.tickets).toHaveLength(1);

      // Verify tickets
      const ticket1 = phase1.tickets[0];
      expect(ticket1.title).toBe("Setup database schema");
      expect(ticket1.priority).toBe("HIGH");
      expect(ticket1.dependsOnTaskIds).toEqual([]);

      const ticket2 = phase1.tickets[1];
      expect(ticket2.title).toBe("Build API endpoints");
      expect(ticket2.dependsOnTaskIds).toHaveLength(1);
      expect(ticket2.dependsOnTaskIds[0]).toBe(ticket1.id); // Real ID, not "T1"

      const ticket3 = phase2.tickets[0];
      expect(ticket3.title).toBe("Implement voice recognition");
      expect(ticket3.dependsOnTaskIds).toHaveLength(2);
      expect(ticket3.dependsOnTaskIds).toContain(ticket1.id);
      expect(ticket3.dependsOnTaskIds).toContain(ticket2.id);

      // Verify database persistence
      const phasesInDb = await db.phase.findMany({
        where: { featureId: feature.id },
        include: { tickets: true },
        orderBy: { order: "asc" },
      });

      expect(phasesInDb).toHaveLength(2);
      expect(phasesInDb[0].name).toBe("Foundation");
      expect(phasesInDb[0].tickets).toHaveLength(2);
      expect(phasesInDb[1].name).toBe("Core Features");
      expect(phasesInDb[1].tickets).toHaveLength(1);
    });

    test("maps tempId dependencies to real ticket IDs correctly", async () => {
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

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "Ticket 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
              { title: "Ticket 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
              { title: "Ticket 3", priority: "MEDIUM" as const, tempId: "T3", dependsOn: ["T1", "T2"] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 201);
      const tickets = data.data[0].tickets;

      // Verify T1 has no dependencies
      expect(tickets[0].dependsOnTaskIds).toEqual([]);

      // Verify T2 depends on T1 (real ID)
      expect(tickets[1].dependsOnTaskIds).toEqual([tickets[0].id]);

      // Verify T3 depends on both T1 and T2 (real IDs)
      expect(tickets[2].dependsOnTaskIds).toHaveLength(2);
      expect(tickets[2].dependsOnTaskIds).toContain(tickets[0].id);
      expect(tickets[2].dependsOnTaskIds).toContain(tickets[1].id);

      // Verify no tempIds remain in database
      expect(tickets[2].dependsOnTaskIds).not.toContain("T1");
      expect(tickets[2].dependsOnTaskIds).not.toContain("T2");
    });

    test("handles cross-phase dependencies", async () => {
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

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "Setup", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            ],
          },
          {
            name: "Phase 2",
            tickets: [
              { title: "Feature", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 201);

      const phase1Ticket = data.data[0].tickets[0];
      const phase2Ticket = data.data[1].tickets[0];

      // Phase 2 ticket depends on Phase 1 ticket (cross-phase dependency)
      expect(phase2Ticket.dependsOnTaskIds).toEqual([phase1Ticket.id]);
    });

    test("uses transaction (atomicity test)", async () => {
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

      const phasesData = {
        phases: [
          {
            name: "Valid Phase",
            tickets: [
              { title: "Ticket 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Verify both phase and ticket were created (transaction succeeded)
      const phasesInDb = await db.phase.findMany({
        where: { featureId: feature.id },
        include: { tickets: true },
      });

      expect(phasesInDb).toHaveLength(1);
      expect(phasesInDb[0].tickets).toHaveLength(1);
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/phases/batch-create",
        { phases: [] }
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "test-id" }),
      });

      await expectUnauthorized(response);
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

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "Ticket", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        nonMember
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "Ticket", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/phases/batch-create",
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "not found", 404);
    });

    test("validates required fields (phases array)", async () => {
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
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        {}, // Missing phases
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Phases array is required", 400);
    });

    test("returns 400 for empty phases array", async () => {
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
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        { phases: [] },
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "cannot be empty", 400);
    });

    test("sets correct ticket order within each phase", async () => {
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

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "First", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
              { title: "Second", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
              { title: "Third", priority: "MEDIUM" as const, tempId: "T3", dependsOn: [] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 201);
      const tickets = data.data[0].tickets;

      expect(tickets[0].order).toBe(0);
      expect(tickets[1].order).toBe(1);
      expect(tickets[2].order).toBe(2);
    });

    test("verifies dependsOnTaskIds contains real IDs not tempIds", async () => {
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

      const phasesData = {
        phases: [
          {
            name: "Phase 1",
            tickets: [
              { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
              { title: "T2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
            ],
          },
        ],
      };

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/phases/batch-create`,
        phasesData,
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify from database
      const ticketInDb = await db.ticket.findFirst({
        where: { title: "T2" },
      });

      expect(ticketInDb?.dependsOnTaskIds).toHaveLength(1);
      // Should be a real database ID (cuid format), not tempId "T1"
      expect(ticketInDb?.dependsOnTaskIds[0]).not.toBe("T1");
      expect(ticketInDb?.dependsOnTaskIds[0]).toMatch(/^c[a-z0-9]{24}$/); // cuid format
    });
  });
});
