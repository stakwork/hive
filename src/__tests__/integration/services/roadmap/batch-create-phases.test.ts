import { describe, test, expect, beforeEach } from "vitest";
import { batchCreatePhasesWithTickets } from "@/services/roadmap/phases";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";

describe("batchCreatePhasesWithTickets Service - Integration Tests", () => {
  beforeEach(() => {
    // Tests run in isolation with database cleanup
  });

  describe("Dependency Mapping", () => {
    test("maps tempIds to real IDs correctly", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "Task A", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            { title: "Task B", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      const ticket1 = result[0].tickets[0];
      const ticket2 = result[0].tickets[1];

      // T1 has no dependencies
      expect(ticket1.dependsOnTaskIds).toEqual([]);

      // T2 depends on T1, should have real ID
      expect(ticket2.dependsOnTaskIds).toHaveLength(1);
      expect(ticket2.dependsOnTaskIds[0]).toBe(ticket1.id);
    });

    test("handles cross-phase dependencies (T1 in phase 1 → T5 in phase 2)", async () => {
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

      const phases = [
        {
          name: "Setup",
          tickets: [
            { title: "Database", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
          ],
        },
        {
          name: "Features",
          tickets: [
            { title: "Feature X", priority: "MEDIUM" as const, tempId: "T5", dependsOn: ["T1"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      const setupTicket = result[0].tickets[0];
      const featureTicket = result[1].tickets[0];

      // Feature ticket should depend on setup ticket (cross-phase)
      expect(featureTicket.dependsOnTaskIds).toEqual([setupTicket.id]);
    });

    test("handles multiple dependencies (T3 depends on [T1, T2])", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "A", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "B", priority: "HIGH" as const, tempId: "T2", dependsOn: [] },
            { title: "C", priority: "MEDIUM" as const, tempId: "T3", dependsOn: ["T1", "T2"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      const ticketA = result[0].tickets[0];
      const ticketB = result[0].tickets[1];
      const ticketC = result[0].tickets[2];

      // C should depend on both A and B
      expect(ticketC.dependsOnTaskIds).toHaveLength(2);
      expect(ticketC.dependsOnTaskIds).toContain(ticketA.id);
      expect(ticketC.dependsOnTaskIds).toContain(ticketB.id);
    });

    test("handles no dependencies (empty dependsOn array)", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "Independent Task", priority: "LOW" as const, tempId: "T1", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      expect(result[0].tickets[0].dependsOnTaskIds).toEqual([]);
    });

    test("handles undefined dependsOn (optional field)", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "Task", priority: "MEDIUM" as const, tempId: "T1" }, // No dependsOn field
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      expect(result[0].tickets[0].dependsOnTaskIds).toEqual([]);
    });
  });

  describe("Ticket Creation", () => {
    test("creates tickets with correct order within each phase", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "First", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Second", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
            { title: "Third", priority: "LOW" as const, tempId: "T3", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      expect(result[0].tickets[0].order).toBe(0);
      expect(result[0].tickets[1].order).toBe(1);
      expect(result[0].tickets[2].order).toBe(2);
    });

    test("assigns correct phaseId to tickets", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "P1 Task", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
          ],
        },
        {
          name: "Phase 2",
          tickets: [
            { title: "P2 Task", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      const phase1Id = result[0].phase.id;
      const phase2Id = result[1].phase.id;

      expect(result[0].tickets[0].phaseId).toBe(phase1Id);
      expect(result[1].tickets[0].phaseId).toBe(phase2Id);
    });

    test("sets ticket count on phase (_count.tickets)", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            { title: "T2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
          ],
        },
        {
          name: "Phase 2",
          tickets: [
            { title: "T3", priority: "MEDIUM" as const, tempId: "T3", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      expect(result[0].phase._count.tickets).toBe(2);
      expect(result[1].phase._count.tickets).toBe(1);
    });

    test("creates tickets with all required fields", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          description: "Test phase",
          tickets: [
            {
              title: "Ticket with description",
              description: "Detailed description here",
              priority: "CRITICAL" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      const ticket = result[0].tickets[0];
      expect(ticket.title).toBe("Ticket with description");
      expect(ticket.description).toBe("Detailed description here");
      expect(ticket.priority).toBe("CRITICAL");
      expect(ticket.status).toBe("TODO"); // Default status
      expect(ticket.featureId).toBe(feature.id);
    });
  });

  describe("Phase Creation", () => {
    test("creates multiple phases with correct order", async () => {
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

      const phases = [
        {
          name: "Setup",
          tickets: [
            { title: "T1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
          ],
        },
        {
          name: "Build",
          tickets: [
            { title: "T2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
          ],
        },
        {
          name: "Deploy",
          tickets: [
            { title: "T3", priority: "LOW" as const, tempId: "T3", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      expect(result[0].phase.name).toBe("Setup");
      expect(result[0].phase.order).toBe(0);

      expect(result[1].phase.name).toBe("Build");
      expect(result[1].phase.order).toBe(1);

      expect(result[2].phase.name).toBe("Deploy");
      expect(result[2].phase.order).toBe(2);
    });

    test("appends to existing phases (increments order)", async () => {
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

      // Create an existing phase
      await db.phase.create({
        data: {
          name: "Existing Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      const phases = [
        {
          name: "New Phase",
          tickets: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTickets(feature.id, user.id, phases);

      // Should start at order 1 (after existing phase at order 0)
      expect(result[0].phase.order).toBe(1);
    });
  });

  describe("Error Handling", () => {
    test("throws error for invalid feature access", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
          ],
        },
      ];

      await expect(
        batchCreatePhasesWithTickets(feature.id, nonMember.id, phases)
      ).rejects.toThrow("Access denied");
    });

    test("throws error when user not found", async () => {
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

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
          ],
        },
      ];

      await expect(
        batchCreatePhasesWithTickets(feature.id, "non-existent-user-id", phases)
      ).rejects.toThrow("Access denied");
    });

    test("throws error for non-existent feature", async () => {
      const user = await createTestUser();

      const phases = [
        {
          name: "Phase 1",
          tickets: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
          ],
        },
      ];

      await expect(
        batchCreatePhasesWithTickets("non-existent-feature-id", user.id, phases)
      ).rejects.toThrow("Feature not found");
    });
  });
});
