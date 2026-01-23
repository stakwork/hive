import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/features/route";
import { db } from "@/lib/db";
import { seedMockData } from "@/utils/mockSeedData";
import { WorkspaceRole } from "@prisma/client";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { createAuthenticatedGetRequest, generateUniqueId } from "@/__tests__/support/helpers";

describe("Features Creator Distribution - Integration Tests", () => {
  let workspaceId: string;
  let testUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create a test user
    const user = await createTestUser({
      name: "Test Owner",
      email: `test-owner-${generateUniqueId("user")}@example.com`,
    });
    testUser = user;

    // Create a test workspace
    const workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: `test-workspace-${generateUniqueId("workspace")}`,
      ownerId: testUser.id,
    });
    workspaceId = workspace.id;

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: workspace.id,
        role: WorkspaceRole.OWNER,
      },
    });

    // Seed mock data with features
    await seedMockData(testUser.id, workspaceId);
  });

  afterEach(async () => {
    // Cleanup - delete workspace and related data
    await db.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
    await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
  });

  describe("GET /api/features - creator filtering", () => {
    it("returns features with varied creators", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspaceId}&limit=50`,
        testUser
      );

      const response = await GET(request);
      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(5);

      // Extract creator IDs from the createdBy user objects
      const creatorIds = result.data.map((f: any) => f.createdBy?.id).filter(Boolean);

      // Verify at least 3 different creators
      const uniqueCreators = new Set(creatorIds);
      expect(uniqueCreators.size).toBeGreaterThanOrEqual(3);
    });

    it("allows filtering by specific creator", async () => {
      // First, get all features to find a creator ID
      const allFeaturesRequest = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspaceId}&limit=50`,
        testUser
      );

      const allFeaturesResponse = await GET(allFeaturesRequest);
      const allResult = await allFeaturesResponse.json();
      const firstCreatorId = allResult.data[0].createdBy?.id;

      // Now filter by that creator
      const filteredRequest = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspaceId}&createdById=${firstCreatorId}`,
        testUser
      );

      const filteredResponse = await GET(filteredRequest);
      expect(filteredResponse.status).toBe(200);
      
      const filteredResult = await filteredResponse.json();

      // All returned features should have the same creator
      filteredResult.data.forEach((feature: any) => {
        expect(feature.createdBy?.id).toBe(firstCreatorId);
      });

      // Should have at least 1 feature (we know feature[0] and feature[4] share a creator)
      expect(filteredResult.data.length).toBeGreaterThanOrEqual(1);
    });

    it("returns unique creator list for filter dropdown", async () => {
      // Get all features
      const request = createAuthenticatedGetRequest(
        `/api/features?workspaceId=${workspaceId}&limit=50`,
        testUser
      );

      const response = await GET(request);
      const result = await response.json();
      const creatorIds = result.data.map((f: any) => f.createdBy?.id).filter(Boolean);

      // Get unique creators
      const uniqueCreators = new Set(creatorIds);

      // Should have at least 3-4 different creators
      expect(uniqueCreators.size).toBeGreaterThanOrEqual(3);
      expect(uniqueCreators.size).toBeLessThanOrEqual(4);
    });
  });

  describe("Database query verification", () => {
    it("confirms features have different creator IDs in database", async () => {
      const features = await db.feature.findMany({
        where: { workspaceId },
        select: { id: true, title: true, createdById: true },
        orderBy: { createdAt: "asc" },
      });

      expect(features).toHaveLength(5);

      // Get unique creator IDs
      const uniqueCreators = new Set(features.map((f) => f.createdById));

      // Should have at least 3 different creators
      expect(uniqueCreators.size).toBeGreaterThanOrEqual(3);

      // Verify modulo pattern: feature[0] and feature[4] should have same creator
      expect(features[0].createdById).toBe(features[4].createdById);

      // Verify first 4 features have different creators
      expect(features[0].createdById).not.toBe(features[1].createdById);
      expect(features[1].createdById).not.toBe(features[2].createdById);
      expect(features[2].createdById).not.toBe(features[3].createdById);
    });

    it("verifies team members were created correctly", async () => {
      // Get all workspace members (excluding the test owner)
      const members = await db.workspaceMember.findMany({
        where: {
          workspaceId,
          userId: { not: testUser.id },
        },
        include: { user: true },
      });

      // Should have 4 team members (Alice, Bob, Carol, David)
      expect(members).toHaveLength(4);

      // Verify their names
      const memberNames = members.map((m) => m.user.name);
      expect(memberNames).toContain("Alice Chen");
      expect(memberNames).toContain("Bob Martinez");
      expect(memberNames).toContain("Carol Johnson");
      expect(memberNames).toContain("David Kim");
    });
  });
});
