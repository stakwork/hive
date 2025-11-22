import { db } from '@/lib/db';
import { generateUniqueId } from '@/__tests__/support/helpers/ids';
import { createTestUser } from '@/__tests__/support/fixtures/user';
import { createTestWorkspace } from '@/__tests__/support/fixtures/workspace';
import { createTestSwarm } from '@/__tests__/support/fixtures/swarm';

/**
 * Creates a complete test scenario with user, workspace, swarm, and feature
 * This is commonly used for integration tests that require a full workspace setup
 */
export async function createTestUserWithWorkspaceAndFeature() {
  return await db.$transaction(async (tx) => {
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId('test-user'),
        email: `test-${generateUniqueId()}@example.com`,
        name: 'Test User',
      },
    });

    const testWorkspace = await tx.workspace.create({
      data: {
        id: generateUniqueId('workspace'),
        name: 'Test Workspace',
        slug: generateUniqueId('test-workspace'),
        description: 'Test workspace description',
        ownerId: testUser.id,
      },
    });

    const testSwarm = await tx.swarm.create({
      data: {
        swarmId: `swarm-${Date.now()}`,
        name: `test-swarm-${Date.now()}`,
        status: 'ACTIVE',
        instanceType: 'XL',
        swarmApiKey: 'test-api-key',
        swarmUrl: 'https://test-swarm.com/api',
        swarmSecretAlias: 'test-secret',
        poolName: 'test-pool',
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
        agentRequestId: null,
        agentStatus: null,
      },
    });

    const testFeature = await tx.feature.create({
      data: {
        id: generateUniqueId('feature'),
        title: 'Test Feature',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    return { testUser, testWorkspace, testSwarm, testFeature };
  });
}

/**
 * Creates a simpler test scenario with user, workspace, and feature (no swarm)
 * Useful for tests that don't require swarm functionality
 */
export async function createTestUserWithWorkspaceAndFeatureOnly() {
  const testUser = await db.user.create({
    data: {
      id: generateUniqueId('test-user'),
      email: `test-${generateUniqueId()}@example.com`,
      name: 'Test User',
    },
  });

  const testWorkspace = await db.workspace.create({
    data: {
      id: generateUniqueId('workspace'),
      name: 'Test Workspace',
      slug: generateUniqueId('test-workspace'),
      description: 'Test workspace without swarm',
      ownerId: testUser.id,
    },
  });

  const testFeature = await db.feature.create({
    data: {
      id: generateUniqueId('feature'),
      title: 'Test Feature',
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      updatedById: testUser.id,
    },
  });

  return { testUser, testWorkspace, testFeature };
}
