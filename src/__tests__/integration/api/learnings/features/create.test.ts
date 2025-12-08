import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/learnings/features/create/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from '@/__tests__/support/fixtures';
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  generateUniqueId,
} from '@/__tests__/support/helpers';
import type { User, Workspace, Swarm, Repository } from '@prisma/client';

/**
 * Helper function to create GitHub auth record with all required fields
 * Also creates Account record with encrypted access token for PAT retrieval
 */
async function createGitHubAuth(userId: string, username: string = 'test-github-user', token: string = 'test-pat-token') {
  const encryptionService = EncryptionService.getInstance();
  const encryptedToken = encryptionService.encryptField('access_token', token);

  await db.gitHubAuth.create({
    data: {
      userId,
      githubUserId: generateUniqueId('github'),
      githubUsername: username,
    },
  });

  // Create Account record with encrypted token for workspace PAT access
  await db.account.create({
    data: {
      userId,
      type: 'oauth',
      provider: 'github',
      providerAccountId: generateUniqueId('provider'),
      access_token: JSON.stringify(encryptedToken),
      token_type: 'bearer',
      scope: 'repo,user',
    },
  });
}

describe('POST /api/learnings/features/create - Authorization', () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let memberViewer: User;
  let memberDeveloper: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: 'Feature Create Owner' },
        members: [{ role: 'VIEWER' }, { role: 'DEVELOPER' }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        'swarmApiKey',
        'test-feature-create-swarm-api-key'
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-feature-create-swarm-${generateUniqueId('swarm')}`,
        status: 'ACTIVE',
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: 'https://test-feature-create-swarm.sphinx.chat',
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create repository
      repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-owner/test-repo',
        branch: 'main',
      });

      // Create GitHub auth and Account for owner
      await tx.gitHubAuth.create({
        data: {
          userId: owner.id,
          githubUserId: generateUniqueId('github'),
          githubUsername: 'test-github-user',
        },
      });

      const encryptedToken = encryptionService.encryptField('access_token', 'test-owner-pat');
      await tx.account.create({
        data: {
          userId: owner.id,
          type: 'oauth',
          provider: 'github',
          providerAccountId: generateUniqueId('provider'),
          access_token: JSON.stringify(encryptedToken),
          token_type: 'bearer',
          scope: 'repo,user',
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: 'Non Member User',
          email: `non-member-feature-create-${generateUniqueId('user')}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 401 for unauthenticated requests', async () => {
    const request = createPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication',
        name: 'Authentication Feature',
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('should return 400 when workspace parameter is missing', async () => {
    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        prompt: 'Add user authentication',
        name: 'Authentication Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 400 when prompt parameter is missing', async () => {
    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        name: 'Authentication Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 400 when name parameter is missing', async () => {
    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 403 for non-member access', async () => {
    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication',
        name: 'Authentication Feature',
      },
      nonMember
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Workspace not found or access denied');
  });

  it('should return 403 for deleted workspace access', async () => {
    await db.workspace.update({
      where: { id: workspace.id },
      data: { deleted: true, deletedAt: new Date() },
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication',
        name: 'Authentication Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Workspace not found or access denied');
  });

  // TODO: These tests timeout because fetch mocking doesn't work properly with in-process POST calls
  // that use long polling. Consider using HTTP-level testing or a different mocking strategy.
  it.skip('should allow VIEWER role to create features', async () => {
    await createGitHubAuth(memberViewer.id, 'test-viewer-github');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: { id: 'feat-123', name: 'Test Feature' } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication',
        name: 'Authentication Feature',
      },
      memberViewer
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it.skip('should allow DEVELOPER role to create features', async () => {
    await createGitHubAuth(memberDeveloper.id, 'test-developer-github');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-456' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: { id: 'feat-456', name: 'Developer Feature' } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add developer tools',
        name: 'Developer Tools Feature',
      },
      memberDeveloper
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it.skip('should allow OWNER role to create features', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-789' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: { id: 'feat-789', name: 'Owner Feature' } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add payment processing',
        name: 'Payment Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });
});

describe('POST /api/learnings/features/create - Infrastructure Requirements', () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: 'Feature Infrastructure Owner' },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        'swarmApiKey',
        'test-infra-swarm-api-key'
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-infra-swarm-${generateUniqueId('swarm')}`,
        status: 'ACTIVE',
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: 'https://test-infra-swarm.sphinx.chat',
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-owner/test-infra-repo',
        branch: 'main',
      });

      await tx.gitHubAuth.create({
        data: {
          userId: owner.id,
          githubUserId: generateUniqueId('github'),
          githubUsername: 'test-infra-github-user',
        },
      });

      const encryptedInfraToken = encryptionService.encryptField('access_token', 'test-infra-pat');
      await tx.account.create({
        data: {
          userId: owner.id,
          type: 'oauth',
          provider: 'github',
          providerAccountId: generateUniqueId('provider'),
          access_token: JSON.stringify(encryptedInfraToken),
          token_type: 'bearer',
          scope: 'repo,user',
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 404 when swarm is not configured', async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: 'No Swarm Owner' },
    });

    await createGitHubAuth(newScenario.owner.id, 'no-swarm-github');
    await createTestRepository({
      workspaceId: newScenario.workspace.id,
      repositoryUrl: 'https://github.com/test/no-swarm-repo',
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: newScenario.workspace.slug,
        prompt: 'Add feature',
        name: 'Test Feature',
      },
      newScenario.owner
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('Swarm');
  });

  it('should return 404 when repository is not configured', async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: 'No Repo Owner' },
    });

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', 'test-key');

    const newSwarm = await createTestSwarm({
      workspaceId: newScenario.workspace.id,
      name: `no-repo-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });

    await db.swarm.update({
      where: { id: newSwarm.id },
      data: {
        swarmUrl: 'https://no-repo-swarm.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    await createGitHubAuth(newScenario.owner.id, 'no-repo-github');

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: newScenario.workspace.slug,
        prompt: 'Add feature',
        name: 'Test Feature',
      },
      newScenario.owner
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('repository');
  });

  it('should return 404 when GitHub PAT is not found', async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: 'No PAT Owner' },
    });

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', 'test-key');

    const newSwarm = await createTestSwarm({
      workspaceId: newScenario.workspace.id,
      name: `no-pat-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });

    await db.swarm.update({
      where: { id: newSwarm.id },
      data: {
        swarmUrl: 'https://no-pat-swarm.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    await createTestRepository({
      workspaceId: newScenario.workspace.id,
      repositoryUrl: 'https://github.com/test/no-pat-repo',
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: newScenario.workspace.slug,
        prompt: 'Add feature',
        name: 'Test Feature',
      },
      newScenario.owner
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('GitHub PAT');
  });

  it('should return 400 for invalid repository URL', async () => {
    await db.repository.update({
      where: { id: repository.id },
      data: { repositoryUrl: 'invalid-url' },
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add feature',
        name: 'Test Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid repository URL');
  });
});

describe('POST /api/learnings/features/create - Swarm Integration', () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: 'Swarm Integration Owner' },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        'swarmApiKey',
        'test-swarm-integration-key'
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-swarm-int-${generateUniqueId('swarm')}`,
        status: 'ACTIVE',
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: 'https://test-swarm-integration.sphinx.chat',
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/swarm-owner/swarm-repo',
        branch: 'main',
      });

      await tx.gitHubAuth.create({
        data: {
          userId: owner.id,
          githubUserId: generateUniqueId('github'),
          githubUsername: 'swarm-int-github-user',
        },
      });

      const encryptedSwarmToken = encryptionService.encryptField('access_token', 'test-swarm-pat');
      await tx.account.create({
        data: {
          userId: owner.id,
          type: 'oauth',
          provider: 'github',
          providerAccountId: generateUniqueId('provider'),
          access_token: JSON.stringify(encryptedSwarmToken),
          token_type: 'bearer',
          scope: 'repo,user',
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skip('should call swarm gitree/create-feature endpoint with correct parameters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, options: any) => {
      if (url.includes('/gitree/create-feature')) {
        const body = JSON.parse(options.body);
        expect(body.prompt).toBe('Add user authentication system');
        expect(body.name).toBe('Authentication Feature');
        expect(body.owner).toBe('swarm-owner');
        expect(body.repo).toBe('swarm-repo');
        expect(options.headers['x-api-token']).toBe('test-swarm-integration-key');
        return new Response(JSON.stringify({ request_id: 'req-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: { id: 'feat-xyz', name: 'Auth Feature' } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Add user authentication system',
        name: 'Authentication Feature',
      },
      owner
    );
    await POST(request);

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.skip('should poll progress endpoint until completion', async () => {
    let pollCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-poll-test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        pollCount++;
        if (pollCount < 3) {
          return new Response(JSON.stringify({ status: 'pending' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: { id: 'feat-poll', name: 'Polled Feature' } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Test polling',
        name: 'Polling Test Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(pollCount).toBeGreaterThanOrEqual(3);
    fetchSpy.mockRestore();
  });

  it('should return error when swarm initiate fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Test failure',
        name: 'Failure Test',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Failed to create feature');
    fetchSpy.mockRestore();
  });

  it.skip('should return error when progress polling fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-fail' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({ status: 'failed', error: 'Feature creation failed' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Test error',
        name: 'Error Test',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('Feature creation failed');
    fetchSpy.mockRestore();
  });

  it('should return 500 when no request_id is returned', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Test no request_id',
        name: 'No Request ID Test',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('No request_id returned');
    fetchSpy.mockRestore();
  });

  it.skip('should return successful response with feature data', async () => {
    const mockFeature = {
      id: 'feat-success',
      name: 'Successful Feature',
      description: 'Successfully created feature',
      files: ['src/feature.ts'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/gitree/create-feature')) {
        return new Response(JSON.stringify({ request_id: 'req-success' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/progress')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            result: { feature: mockFeature, usage: { tokens: 1000 } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(null, { status: 404 });
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Create successful feature',
        name: 'Success Feature',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.feature).toEqual(mockFeature);
    expect(data.usage).toEqual({ tokens: 1000 });
    fetchSpy.mockRestore();
  });

  it('should handle network errors gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network connection failed')
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings/features/create`,
      {
        workspace: workspace.slug,
        prompt: 'Test network error',
        name: 'Network Error Test',
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('Failed to create feature');
    fetchSpy.mockRestore();
  });
});
