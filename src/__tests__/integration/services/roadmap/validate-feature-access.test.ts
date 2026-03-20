import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { validateFeatureAccess } from '@/services/roadmap/utils';

describe('validateFeatureAccess - Soft Delete Validation', () => {
  let testWorkspace: { id: string };
  let testUser: { id: string };
  let testFeature: { id: string };

  beforeEach(async () => {
    // Create test user
    testUser = await db.users.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    });

    // Create test workspace
    testWorkspace = await db.workspaces.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,owner_id: testUser.id,
      },
    });

    // Add user as workspace owner
    await db.workspace_members.create({
      data: {workspace_id: testWorkspace.id,user_id: testUser.id,
        role: 'OWNER',
      },
    });

    // Create test feature
    testFeature = await db.features.create({
      data: {
        title: 'Test Feature',workspace_id: testWorkspace.id,
        status: 'BACKLOG',
        priority: 'MEDIUM',created_by_id: testUser.id,updated_by_id: testUser.id,
      },
    });
  });

  afterEach(async () => {
    // Cleanup in reverse order of dependencies
    await db.features.deleteMany({
      where: {workspace_id: testWorkspace.id },
    });
    await db.workspace_members.deleteMany({
      where: {workspace_id: testWorkspace.id },
    });
    await db.workspaces.deleteMany({
      where: { id: testWorkspace.id },
    });
    await db.users.deleteMany({
      where: { id: testUser.id },
    });
  });

  describe('Soft-deleted feature validation', () => {
    it('should throw "Feature not found" when feature is soft-deleted', async () => {
      // Soft delete the feature
      await db.features.update({
        where: { id: testFeature.id },
        data: { deleted: true },
      });

      await expect(
        validateFeatureAccess(testFeature.id, testUser.id)
      ).rejects.toThrow('Feature not found');
    });

    it('should return feature when not soft-deleted', async () => {
      const result = await validateFeatureAccess(testFeature.id, testUser.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(testFeature.id);
      expect(result.deleted).toBe(false);
    });

    it('should prioritize soft-delete check before permission check', async () => {
      // Soft delete the feature
      await db.features.update({
        where: { id: testFeature.id },
        data: { deleted: true },
      });

      // Create a user without permissions
      const unauthorizedUser = await db.users.create({
        data: {
          email: `unauthorized-${Date.now()}@example.com`,
          name: 'Unauthorized User',
        },
      });

      // Should throw "Feature not found" for soft-deleted feature, not permission error
      await expect(
        validateFeatureAccess(testFeature.id, unauthorizedUser.id)
      ).rejects.toThrow('Feature not found');

      // Cleanup
      await db.users.delete({
        where: { id: unauthorizedUser.id },
      });
    });

    it('should handle feature with deleted field set to false', async () => {
      // Explicitly set deleted to false
      await db.features.update({
        where: { id: testFeature.id },
        data: { deleted: false },
      });

      const result = await validateFeatureAccess(testFeature.id, testUser.id);

      expect(result).toBeDefined();
      expect(result.deleted).toBe(false);
    });

    it('should throw "Feature not found" for soft-deleted feature even if user is owner', async () => {
      // Soft delete the feature
      await db.features.update({
        where: { id: testFeature.id },
        data: { deleted: true },
      });

      // Even the owner should get "Feature not found"
      await expect(
        validateFeatureAccess(testFeature.id, testUser.id)
      ).rejects.toThrow('Feature not found');
    });
  });

  describe('Permission checks with non-deleted features', () => {
    it('should allow access with sufficient role (owner)', async () => {
      const result = await validateFeatureAccess(testFeature.id, testUser.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(testFeature.id);
    });

    it('should allow access for workspace member', async () => {
      // Create a new user and add as member
      const memberUser = await db.users.create({
        data: {
          email: `member-${Date.now()}@example.com`,
          name: 'Member User',
        },
      });

      await db.workspace_members.create({
        data: {workspace_id: testWorkspace.id,user_id: memberUser.id,
          role: 'DEVELOPER',
        },
      });

      const result = await validateFeatureAccess(testFeature.id, memberUser.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(testFeature.id);

      // Cleanup
      await db.workspace_members.deleteMany({
        where: {user_id: memberUser.id },
      });
      await db.users.delete({
        where: { id: memberUser.id },
      });
    });

    it('should throw "Access denied" for non-member user', async () => {
      // Create a user without workspace membership
      const outsideUser = await db.users.create({
        data: {
          email: `outside-${Date.now()}@example.com`,
          name: 'Outside User',
        },
      });

      await expect(
        validateFeatureAccess(testFeature.id, outsideUser.id)
      ).rejects.toThrow('Access denied');

      // Cleanup
      await db.users.delete({
        where: { id: outsideUser.id },
      });
    });

    it('should throw "Feature not found" when feature does not exist', async () => {
      const nonExistentId = 'non-existent-feature-id';

      await expect(
        validateFeatureAccess(nonExistentId, testUser.id)
      ).rejects.toThrow('Feature not found');
    });

    it('should throw "Feature not found" when workspace is soft-deleted', async () => {
      // Soft delete the workspace
      await db.workspaces.update({
        where: { id: testWorkspace.id },
        data: { deleted: true },
      });

      await expect(
        validateFeatureAccess(testFeature.id, testUser.id)
      ).rejects.toThrow('Feature not found');
    });
  });
});
