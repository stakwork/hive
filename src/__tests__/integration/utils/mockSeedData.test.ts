import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMockData } from "@/utils/mockSeedData";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";

describe("mockSeedData - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("seedFeatures creator distribution", () => {
    test("distributes feature creators across team members", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-seed-workspace",
      });

      // Act - seed the workspace with mock data
      await seedMockData(user.id, workspace.id);

      // Assert - query features and verify varied creators
      const features = await db.feature.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          title: true,
          createdById: true,
          updatedById: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // Should have 5 features
      expect(features).toHaveLength(5);

      // Extract unique creator IDs
      const uniqueCreatorIds = new Set(features.map((f) => f.createdById));

      // Should have at least 3-4 different creators (as per requirements)
      expect(uniqueCreatorIds.size).toBeGreaterThanOrEqual(3);
      expect(uniqueCreatorIds.size).toBeLessThanOrEqual(4);

      // Verify creators rotate through the userIds array
      // With 5 features and 4 users, distribution should be:
      // Feature 0 -> userIds[0], Feature 1 -> userIds[1], Feature 2 -> userIds[2],
      // Feature 3 -> userIds[3], Feature 4 -> userIds[0]
      const creatorIds = features.map((f) => f.createdById);
      expect(creatorIds[0]).toBe(creatorIds[4]); // First and fifth should have same creator

      // Verify updatedById matches createdById for each feature
      for (const feature of features) {
        expect(feature.updatedById).toBe(feature.createdById);
      }
    });

    test("rotates creators using modulo pattern", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace 2",
        slug: "test-seed-workspace-2",
      });

      // Act
      await seedMockData(user.id, workspace.id);

      // Assert
      const features = await db.feature.findMany({
        where: { workspaceId: workspace.id },
        select: { createdById: true },
        orderBy: { createdAt: "asc" },
      });

      const creatorIds = features.map((f) => f.createdById);

      // With 5 features and 4 team members, verify rotation pattern
      // 0 % 4 = 0, 1 % 4 = 1, 2 % 4 = 2, 3 % 4 = 3, 4 % 4 = 0
      expect(creatorIds[0]).toBe(creatorIds[4]); // index 0 and 4 should match
      expect(creatorIds[0]).not.toBe(creatorIds[1]);
      expect(creatorIds[1]).not.toBe(creatorIds[2]);
      expect(creatorIds[2]).not.toBe(creatorIds[3]);
    });

    test("each feature has a valid creator from workspace members", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace 3",
        slug: "test-seed-workspace-3",
      });

      // Act
      await seedMockData(user.id, workspace.id);

      // Assert - get all workspace members
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
        select: { userId: true },
      });

      const memberUserIds = new Set(members.map((m) => m.userId));

      // Get all features
      const features = await db.feature.findMany({
        where: { workspaceId: workspace.id },
        select: { createdById: true },
      });

      // Verify each feature creator is a workspace member
      for (const feature of features) {
        expect(memberUserIds.has(feature.createdById)).toBe(true);
      }
    });
  });
});
