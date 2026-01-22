import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { seedMockData } from "@/utils/mockSeedData";

// Mock config to enable USE_MOCKS for testing
vi.mock("@/config/env", async () => {
  const actual = await vi.importActual("@/config/env");
  return {
    ...actual,
    config: {
      ...(actual as any).config,
      USE_MOCKS: true,
    },
  };
});

describe("Mock Seed Data - Feature Creators Integration", () => {
  let createdWorkspaceId: string | null = null;
  let createdUserIds: string[] = [];

  afterEach(async () => {
    // Clean up test data in reverse order of dependencies
    if (createdWorkspaceId) {
      // Delete all related data for the workspace
      await db.userStory.deleteMany({ where: { feature: { workspaceId: createdWorkspaceId } } });
      await db.phase.deleteMany({ where: { feature: { workspaceId: createdWorkspaceId } } });
      await db.feature.deleteMany({ where: { workspaceId: createdWorkspaceId } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: createdWorkspaceId } });
      await db.workspace.delete({ where: { id: createdWorkspaceId } });
    }
    
    // Clean up users
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    createdWorkspaceId = null;
    createdUserIds = [];
  });

  it("should create features with varied creators from team members", async () => {
    // Create a test user
    const testUser = await db.user.create({
      data: {
        email: `owner-${Date.now()}@example.com`,
        name: "Test Owner",
      },
    });
    createdUserIds.push(testUser.id);

    // Create a test workspace
    const testWorkspace = await db.workspace.create({
      data: {
        name: "Test Feature Creators Workspace",
        slug: `test-feature-creators-${Date.now()}`,
        ownerId: testUser.id,
      },
    });
    createdWorkspaceId = testWorkspace.id;

    // Seed mock data (which will create features with varied creators)
    await seedMockData(testUser.id, testWorkspace.id);

    // Query the features created in this workspace
    const features = await db.feature.findMany({
      where: { workspaceId: createdWorkspaceId },
      select: {
        id: true,
        title: true,
        createdById: true,
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Verify at least 5 features were created
    expect(features.length).toBeGreaterThanOrEqual(5);

    // Collect unique creator IDs and names
    const uniqueCreatorIds = new Set(features.map((f) => f.createdById));
    const creatorNames = new Set(
      features.map((f) => f.createdBy.name).filter((name): name is string => name !== null)
    );

    // Verify at least 3-4 different creators are represented
    expect(uniqueCreatorIds.size).toBeGreaterThanOrEqual(3);
    expect(uniqueCreatorIds.size).toBeLessThanOrEqual(4);

    // Verify expected team member names appear as creators
    const expectedNames = ["Alice Chen", "Bob Martinez", "Carol Johnson", "David Kim"];
    const foundNames = Array.from(creatorNames);
    
    // At least 3 of the expected names should be present
    const matchingNames = foundNames.filter((name) => expectedNames.includes(name));
    expect(matchingNames.length).toBeGreaterThanOrEqual(3);

    // Store user IDs for cleanup
    createdUserIds = Array.from(uniqueCreatorIds);

    // Log the distribution for manual verification
    console.log("\n=== Feature Creator Distribution ===");
    features.slice(0, 5).forEach((feature, index) => {
      console.log(
        `Feature ${index + 1}: "${feature.title}" created by ${feature.createdBy.name} (${feature.createdBy.email})`
      );
    });

    // Verify no single creator created all features (distribution is working)
    const featuresByCreator = features.reduce(
      (acc, feature) => {
        acc[feature.createdById] = (acc[feature.createdById] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const maxFeaturesPerCreator = Math.max(...Object.values(featuresByCreator));
    const minFeaturesPerCreator = Math.min(...Object.values(featuresByCreator));

    // No single creator should have created all features
    expect(maxFeaturesPerCreator).toBeLessThan(features.length);

    // Distribution should be relatively balanced (within reason)
    // If we have 5 features and 4 creators, max should be 2, min should be 1
    const expectedMax = Math.ceil(5 / uniqueCreatorIds.size);
    expect(maxFeaturesPerCreator).toBeLessThanOrEqual(expectedMax + 1); // Allow some flexibility
  });

  it("should query features by different creators using database", async () => {
    // Create a test user
    const testUser = await db.user.create({
      data: {
        email: `query-owner-${Date.now()}@example.com`,
        name: "Query Test Owner",
      },
    });
    createdUserIds.push(testUser.id);

    // Create a test workspace
    const testWorkspace = await db.workspace.create({
      data: {
        name: "Test Query Feature Creators",
        slug: `test-query-creators-${Date.now()}`,
        ownerId: testUser.id,
      },
    });
    createdWorkspaceId = testWorkspace.id;

    // Seed mock data
    await seedMockData(testUser.id, testWorkspace.id);

    // Get all features
    const allFeatures = await db.feature.findMany({
      where: { workspaceId: createdWorkspaceId },
      select: { createdById: true },
    });

    const uniqueCreatorIds = [...new Set(allFeatures.map((f) => f.createdById))];
    createdUserIds = uniqueCreatorIds;

    // Query features by each creator
    for (const creatorId of uniqueCreatorIds) {
      const featuresByCreator = await db.feature.findMany({
        where: {
          workspaceId: createdWorkspaceId,
          createdById: creatorId,
        },
        select: {
          id: true,
          title: true,
          createdBy: {
            select: { name: true },
          },
        },
      });

      // Verify we can filter by creator and get results
      expect(featuresByCreator.length).toBeGreaterThan(0);
      console.log(
        `Creator ${featuresByCreator[0].createdBy.name} created ${featuresByCreator.length} feature(s)`
      );
    }

    // Verify we have multiple creators
    expect(uniqueCreatorIds.length).toBeGreaterThanOrEqual(3);
  });

  it("should support filtering features by creator in the UI (simulated)", async () => {
    // Create a test user
    const testUser = await db.user.create({
      data: {
        email: `filter-owner-${Date.now()}@example.com`,
        name: "Filter Test Owner",
      },
    });
    createdUserIds.push(testUser.id);

    // Create a test workspace
    const testWorkspace = await db.workspace.create({
      data: {
        name: "Test Filter UI Creators",
        slug: `test-filter-ui-${Date.now()}`,
        ownerId: testUser.id,
      },
    });
    createdWorkspaceId = testWorkspace.id;

    // Seed mock data
    await seedMockData(testUser.id, testWorkspace.id);

    // Simulate fetching creators for filter dropdown
    const creators = await db.user.findMany({
      where: {
        createdFeatures: {
          some: {
            workspaceId: createdWorkspaceId,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: {
            createdFeatures: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    createdUserIds = creators.map((c) => c.id);

    // Verify multiple creators are available for filtering
    expect(creators.length).toBeGreaterThanOrEqual(3);

    // Verify each creator has at least one feature
    creators.forEach((creator) => {
      expect(creator._count.createdFeatures).toBeGreaterThan(0);
    });

    // Log creators for manual verification
    console.log("\n=== Available Creators for Filter Dropdown ===");
    creators.forEach((creator) => {
      console.log(
        `- ${creator.name} (${creator.email}): ${creator._count.createdFeatures} feature(s)`
      );
    });

    // Simulate selecting a creator filter
    const selectedCreator = creators[0];
    const filteredFeatures = await db.feature.findMany({
      where: {
        workspaceId: createdWorkspaceId,
        createdById: selectedCreator.id,
      },
      select: {
        id: true,
        title: true,
      },
    });

    expect(filteredFeatures.length).toBeGreaterThan(0);
    expect(filteredFeatures.length).toBeLessThanOrEqual(selectedCreator._count.createdFeatures);
  });
});
