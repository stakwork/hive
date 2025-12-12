import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/fixtures/user';
import { createTestWorkspace } from '@/__tests__/support/fixtures/workspace';
import { createTestFeature } from '@/__tests__/support/fixtures/feature';

describe('Features Filtering - Integration Tests', () => {
  let testWorkspaceId: string;
  let testUserId: string;
  const testWorkspaceSlug = 'test-filtering-workspace';
  const createdFeatureIds: string[] = [];

  beforeEach(async () => {
    // Create test user
    const user = await createTestUser({});
    testUserId = user.id;

    // Create test workspace
    const workspace = await createTestWorkspace({
      slug: testWorkspaceSlug,
      ownerId: testUserId,
    });
    testWorkspaceId = workspace.id;

    // Create test features with various statuses and priorities
    const feature1 = await createTestFeature({
      workspaceId: testWorkspaceId,
      title: 'Feature 1',
      brief: 'Test feature 1',
      status: 'PLANNED',
      priority: 'HIGH',
      createdById: testUserId,
      updatedById: testUserId,
    });
    createdFeatureIds.push(feature1.id);

    const feature2 = await createTestFeature({
      workspaceId: testWorkspaceId,
      title: 'Feature 2',
      brief: 'Test feature 2',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      createdById: testUserId,
      updatedById: testUserId,
    });
    createdFeatureIds.push(feature2.id);

    const feature3 = await createTestFeature({
      workspaceId: testWorkspaceId,
      title: 'Feature 3',
      brief: 'Test feature 3',
      status: 'COMPLETED',
      priority: 'LOW',
      createdById: testUserId,
      updatedById: testUserId,
    });
    createdFeatureIds.push(feature3.id);

    const feature4 = await createTestFeature({
      workspaceId: testWorkspaceId,
      title: 'Feature 4',
      brief: 'Test feature 4',
      status: 'PLANNED',
      priority: 'LOW',
      createdById: testUserId,
      updatedById: testUserId,
    });
    createdFeatureIds.push(feature4.id);
  });

  afterEach(async () => {
    // Cleanup in reverse order of creation
    await db.feature.deleteMany({
      where: { id: { in: createdFeatureIds } },
    });
    createdFeatureIds.length = 0;

    await db.workspaceMember.deleteMany({
      where: { workspaceId: testWorkspaceId },
    });
    await db.workspace.delete({
      where: { id: testWorkspaceId },
    });
    await db.user.delete({
      where: { id: testUserId },
    });
  });

  describe('Status Filter', () => {
    it('should filter features by single status', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: 'PLANNED',
        },
      });

      expect(features).toHaveLength(2);
      expect(features.every((f) => f.status === 'PLANNED')).toBe(true);
    });

    it('should filter features by multiple statuses', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: {
            in: ['PLANNED', 'IN_PROGRESS'],
          },
        },
      });

      expect(features).toHaveLength(3);
      expect(features.every((f) => ['PLANNED', 'IN_PROGRESS'].includes(f.status))).toBe(true);
    });

    it('should return all features when status filter is empty', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
      });

      expect(features).toHaveLength(4);
    });
  });

  describe('Priority Filter', () => {
    it('should filter features by single priority', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          priority: 'HIGH',
        },
      });

      expect(features).toHaveLength(1);
      expect(features[0].priority).toBe('HIGH');
    });

    it('should filter features by multiple priorities', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          priority: {
            in: ['HIGH', 'MEDIUM'],
          },
        },
      });

      expect(features).toHaveLength(2);
      expect(features.every((f) => ['HIGH', 'MEDIUM'].includes(f.priority))).toBe(true);
    });

    it('should return all features when priority filter is empty', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
      });

      expect(features).toHaveLength(4);
    });
  });

  describe('Combined Filters', () => {
    it('should filter features by both status and priority', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: 'PLANNED',
          priority: 'LOW',
        },
      });

      expect(features).toHaveLength(1);
      expect(features[0].title).toBe('Feature 4');
    });

    it('should handle complex multi-filter scenarios', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: {
            in: ['PLANNED', 'IN_PROGRESS'],
          },
          priority: {
            in: ['HIGH', 'MEDIUM'],
          },
        },
      });

      expect(features).toHaveLength(2);
      expect(features.some((f) => f.title === 'Feature 1')).toBe(true);
      expect(features.some((f) => f.title === 'Feature 2')).toBe(true);
    });
  });

  describe('Search Filter', () => {
    it('should filter features by title search', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          title: {
            contains: 'Feature 1',
            mode: 'insensitive',
          },
        },
      });

      expect(features).toHaveLength(1);
      expect(features[0].title).toBe('Feature 1');
    });

    it('should filter features by brief search', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          brief: {
            contains: 'Test feature',
            mode: 'insensitive',
          },
        },
      });

      expect(features).toHaveLength(4);
    });

    it('should combine search with other filters', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: 'PLANNED',
          title: {
            contains: 'Feature',
            mode: 'insensitive',
          },
        },
      });

      expect(features).toHaveLength(2);
      expect(features.every((f) => f.status === 'PLANNED')).toBe(true);
    });
  });

  describe('Assignee Filter', () => {
    it('should filter features by creator', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          createdById: testUserId,
        },
      });

      expect(features).toHaveLength(4);
      expect(features.every((f) => f.createdById === testUserId)).toBe(true);
    });

    it('should return all features when assignee filter is ALL', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
      });

      expect(features).toHaveLength(4);
    });
  });

  describe('Empty State Detection', () => {
    it('should correctly identify workspace with features', async () => {
      const totalCount = await db.feature.count({
        where: {
          workspaceId: testWorkspaceId,
        },
      });

      expect(totalCount).toBeGreaterThan(0);
    });

    it('should correctly identify empty results with active filters', async () => {
      const filteredCount = await db.feature.count({
        where: {
          workspaceId: testWorkspaceId,
          status: 'CANCELLED', // Non-existent status in our test data
        },
      });

      const totalCount = await db.feature.count({
        where: {
          workspaceId: testWorkspaceId,
        },
      });

      expect(filteredCount).toBe(0);
      expect(totalCount).toBeGreaterThan(0);
    });
  });

  describe('Sort Functionality', () => {
    it('should sort features by updatedAt ascending', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
        orderBy: {
          updatedAt: 'asc',
        },
      });

      expect(features).toHaveLength(4);
      // Verify ascending order
      for (let i = 0; i < features.length - 1; i++) {
        expect(features[i].updatedAt.getTime()).toBeLessThanOrEqual(
          features[i + 1].updatedAt.getTime()
        );
      }
    });

    it('should sort features by updatedAt descending', async () => {
      const features = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      expect(features).toHaveLength(4);
      // Verify descending order
      for (let i = 0; i < features.length - 1; i++) {
        expect(features[i].updatedAt.getTime()).toBeGreaterThanOrEqual(
          features[i + 1].updatedAt.getTime()
        );
      }
    });
  });

  describe('Individual Filter Reset', () => {
    it('should allow resetting status filter independently', async () => {
      // First apply status filter
      const filteredFeatures = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: 'PLANNED',
        },
      });
      expect(filteredFeatures).toHaveLength(2);

      // Then reset to show all
      const allFeatures = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
      });
      expect(allFeatures).toHaveLength(4);
    });

    it('should allow resetting priority filter independently', async () => {
      // First apply priority filter
      const filteredFeatures = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          priority: 'HIGH',
        },
      });
      expect(filteredFeatures).toHaveLength(1);

      // Then reset to show all
      const allFeatures = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
        },
      });
      expect(allFeatures).toHaveLength(4);
    });

    it('should maintain other filters when resetting one filter', async () => {
      // Apply status and priority filters
      const bothFilters = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          status: 'PLANNED',
          priority: 'LOW',
        },
      });
      expect(bothFilters).toHaveLength(1);

      // Reset status but keep priority
      const priorityOnly = await db.feature.findMany({
        where: {
          workspaceId: testWorkspaceId,
          priority: 'LOW',
        },
      });
      expect(priorityOnly).toHaveLength(2);
      expect(priorityOnly.every((f) => f.priority === 'LOW')).toBe(true);
    });
  });
});
