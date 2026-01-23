import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/features/route";
import { db } from "@/lib/db";
import { seedMockData } from "@/utils/mockSeedData";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";

describe("Features API - Creator Distribution Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/features - with varied creators from seed data", () => {
    test("returns features with different creators after seeding", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace-seed",
      });

      // Seed the workspace with mock data
      await seedMockData(user.id, workspace.id);

      // Act - fetch features via API
      const request = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspace.id}`,
        user
      );
      const response = await GET(request);

      // Assert
      const data = await expectSuccess(response);

      expect(data.data).toHaveLength(5);

      // Extract unique creator IDs
      const uniqueCreatorIds = new Set(
        data.data.map((f: any) => f.createdBy.id)
      );

      // Should have at least 3 different creators (as per requirements)
      expect(uniqueCreatorIds.size).toBeGreaterThanOrEqual(3);
    });

    test("features endpoint includes creator information", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace 2",
        slug: "test-workspace-seed-2",
      });

      // Seed the workspace
      await seedMockData(user.id, workspace.id);

      // Act
      const request = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspace.id}`,
        user
      );
      const response = await GET(request);

      // Assert
      const data = await expectSuccess(response);

      // Verify each feature has creator info if API returns it
      for (const feature of data.data) {
        expect(feature.createdBy).toBeDefined();
        expect(feature.createdBy.id).toBeDefined();
        expect(typeof feature.createdBy.id).toBe("string");
      }
    });

    test("can query features by different creators", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace 3",
        slug: "test-workspace-seed-3",
      });

      // Seed the workspace
      await seedMockData(user.id, workspace.id);

      // Get all features and their creators
      const allFeatures = await db.feature.findMany({
        where: { workspaceId: workspace.id },
        select: { id: true, createdById: true, title: true },
      });

      const uniqueCreatorIds = Array.from(
        new Set(allFeatures.map((f) => f.createdById))
      );

      // Should have multiple creators
      expect(uniqueCreatorIds.length).toBeGreaterThanOrEqual(3);

      // Query features by each creator
      for (const creatorId of uniqueCreatorIds) {
        const featuresForCreator = await db.feature.findMany({
          where: {
            workspaceId: workspace.id,
            createdById: creatorId,
          },
        });

        // Each creator should have at least 1 feature
        expect(featuresForCreator.length).toBeGreaterThanOrEqual(1);
      }
    });

    test("creator names available for filter dropdown", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace 4",
        slug: "test-workspace-seed-4",
      });

      // Seed the workspace
      await seedMockData(user.id, workspace.id);

      // Query to get unique creators with their user info (like a filter dropdown would)
      const featuresWithCreators = await db.feature.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          createdById: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Get unique creator names
      const uniqueCreatorNames = new Set(
        featuresWithCreators.map((f) => f.createdBy.name)
      );

      // Should have multiple creator names for dropdown
      expect(uniqueCreatorNames.size).toBeGreaterThanOrEqual(3);

      // Verify expected team member names are present
      const creatorNamesArray = Array.from(uniqueCreatorNames);
      const expectedNames = ["Alice Chen", "Bob Martinez", "Carol Johnson", "David Kim"];
      
      // At least 3 of the expected names should be present
      const matchingNames = creatorNamesArray.filter(name => 
        expectedNames.includes(name as string)
      );
      expect(matchingNames.length).toBeGreaterThanOrEqual(3);
    });
  });
});
