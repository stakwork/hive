import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { seedMockData } from "@/utils/mockSeedData";
import { WorkspaceRole } from "@prisma/client";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers";

describe("mockSeedData - Integration Tests", () => {
  let workspaceId: string;
  let testUserId: string;

  beforeEach(async () => {
    // Create a test user
    const user = await createTestUser({
      name: "Test Owner",
      email: `test-owner-${generateUniqueId("user")}@example.com`,
    });
    testUserId = user.id;

    // Create a test workspace
    const workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: `test-workspace-${generateUniqueId("workspace")}`,
      ownerId: testUserId,
    });
    workspaceId = workspace.id;

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        userId: testUserId,
        workspaceId: workspace.id,
        role: WorkspaceRole.OWNER,
      },
    });
  });

  afterEach(async () => {
    // Cleanup - delete workspace and related data
    await db.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
    await db.user.delete({ where: { id: testUserId } }).catch(() => {});
  });

  describe("seedFeatures creator distribution", () => {
    it("creates features with different createdById values", async () => {
      // Seed mock data
      await seedMockData(testUserId, workspaceId);

      // Fetch all features for the workspace
      const features = await db.feature.findMany({
        where: { workspaceId },
        select: { id: true, title: true, createdById: true },
        orderBy: { createdAt: "asc" },
      });

      expect(features).toHaveLength(5);

      // Extract creator IDs
      const creatorIds = features.map((f) => f.createdById);

      // Verify all creator IDs are defined
      creatorIds.forEach((id) => {
        expect(id).toBeDefined();
        expect(id).not.toBeNull();
      });

      // Verify at least 3 different creators
      const uniqueCreators = new Set(creatorIds);
      expect(uniqueCreators.size).toBeGreaterThanOrEqual(3);
    });

    it("rotates creators using modulo pattern", async () => {
      // Seed mock data
      await seedMockData(testUserId, workspaceId);

      // Fetch all features for the workspace
      const features = await db.feature.findMany({
        where: { workspaceId },
        select: { id: true, title: true, createdById: true },
        orderBy: { createdAt: "asc" },
      });

      expect(features).toHaveLength(5);

      // Extract creator IDs
      const creatorIds = features.map((f) => f.createdById);

      // With 4 team members and 5 features:
      // 0 % 4 = 0, 1 % 4 = 1, 2 % 4 = 2, 3 % 4 = 3, 4 % 4 = 0
      expect(creatorIds[0]).toBe(creatorIds[4]); // index 0 and 4 should wrap around
      expect(creatorIds[0]).not.toBe(creatorIds[1]);
      expect(creatorIds[1]).not.toBe(creatorIds[2]);
      expect(creatorIds[2]).not.toBe(creatorIds[3]);
    });

    it("distributes creators evenly across features", async () => {
      // Seed mock data
      await seedMockData(testUserId, workspaceId);

      // Fetch all features for the workspace
      const features = await db.feature.findMany({
        where: { workspaceId },
        select: { id: true, title: true, createdById: true },
        orderBy: { createdAt: "asc" },
      });

      expect(features).toHaveLength(5);

      // Extract creator IDs
      const creatorIds = features.map((f) => f.createdById);

      // Count occurrences of each creator
      const creatorCounts = creatorIds.reduce(
        (acc, id) => {
          acc[id] = (acc[id] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // With 5 features and 4 team members, expect distribution:
      // One creator has 2 features, others have 1 each
      const counts = Object.values(creatorCounts);
      expect(counts).toContain(2); // One creator with 2 features
      expect(counts.filter((c) => c === 1).length).toBe(3); // Three creators with 1 feature each
    });
  });
});
