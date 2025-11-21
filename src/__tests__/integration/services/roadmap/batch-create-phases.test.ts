import { describe, test, expect, beforeEach } from "vitest";
import { batchCreatePhasesWithTasks } from "@/services/roadmap/phases";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";

describe("batchCreatePhasesWithTasks Service - Integration Tests", () => {
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
          tasks: [
            { title: "Task A", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            { title: "Task B", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      const ticket1 = result[0].tasks[0];
      const ticket2 = result[0].tasks[1];

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
          tasks: [{ title: "Database", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Features",
          tasks: [{ title: "Feature X", priority: "MEDIUM" as const, tempId: "T5", dependsOn: ["T1"] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      const setupTicket = result[0].tasks[0];
      const featureTicket = result[1].tasks[0];

      // Feature task should depend on setup task (cross-phase)
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
          tasks: [
            { title: "A", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "B", priority: "HIGH" as const, tempId: "T2", dependsOn: [] },
            { title: "C", priority: "MEDIUM" as const, tempId: "T3", dependsOn: ["T1", "T2"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      const ticketA = result[0].tasks[0];
      const ticketB = result[0].tasks[1];
      const ticketC = result[0].tasks[2];

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
          tasks: [{ title: "Independent Task", priority: "LOW" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      expect(result[0].tasks[0].dependsOnTaskIds).toEqual([]);
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
          tasks: [
            { title: "Task", priority: "MEDIUM" as const, tempId: "T1" }, // No dependsOn field
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      expect(result[0].tasks[0].dependsOnTaskIds).toEqual([]);
    });
  });

  describe("Task Creation", () => {
    test("creates tasks with correct order within each phase", async () => {
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
          tasks: [
            { title: "First", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Second", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
            { title: "Third", priority: "LOW" as const, tempId: "T3", dependsOn: [] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      expect(result[0].tasks[0].order).toBe(0);
      expect(result[0].tasks[1].order).toBe(1);
      expect(result[0].tasks[2].order).toBe(2);
    });

    test("assigns correct phaseId to tasks", async () => {
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
          tasks: [{ title: "P1 Task", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Phase 2",
          tasks: [{ title: "P2 Task", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      const phase1Id = result[0].phase.id;
      const phase2Id = result[1].phase.id;

      expect(result[0].tasks[0].phaseId).toBe(phase1Id);
      expect(result[1].tasks[0].phaseId).toBe(phase2Id);
    });

    test("sets task count on phase (_count.tasks)", async () => {
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
          tasks: [
            { title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            { title: "T2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
          ],
        },
        {
          name: "Phase 2",
          tasks: [{ title: "T3", priority: "MEDIUM" as const, tempId: "T3", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      expect(result[0].phase._count.tasks).toBe(2);
      expect(result[1].phase._count.tasks).toBe(1);
    });

    test("creates tasks with all required fields", async () => {
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
          tasks: [
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

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

      const task = result[0].tasks[0];
      expect(task.title).toBe("Ticket with description");
      expect(task.description).toBe("Detailed description here");
      expect(task.priority).toBe("CRITICAL");
      expect(task.status).toBe("TODO"); // Default status
      expect(task.featureId).toBe(feature.id);
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
          tasks: [{ title: "T1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Build",
          tasks: [{ title: "T2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] }],
        },
        {
          name: "Deploy",
          tasks: [{ title: "T3", priority: "LOW" as const, tempId: "T3", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

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
          tasks: [{ title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(feature.id, user.id, phases);

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
          tasks: [{ title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks(feature.id, nonMember.id, phases)).rejects.toThrow("Access denied");
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
          tasks: [{ title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks(feature.id, "non-existent-user-id", phases)).rejects.toThrow(
        "Access denied",
      );
    });

    test("throws error for non-existent feature", async () => {
      const user = await createTestUser();

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "T1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks("non-existent-feature-id", user.id, phases)).rejects.toThrow(
        "Feature not found",
      );
    });
  });
});
