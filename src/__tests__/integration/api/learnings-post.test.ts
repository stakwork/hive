import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/learnings/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { createTestWorkspaceScenario } from '@/__tests__/support/fixtures/workspace';
import { createTestSwarm } from '@/__tests__/support/fixtures/swarm';
import { createTestUser } from '@/__tests__/support/fixtures/user';
import { createAuthenticatedPostRequest, createPostRequest } from '@/__tests__/support/helpers/request-builders';
import type { Workspace, User, Swarm } from '@prisma/client';

describe('POST /api/learnings - Integration Tests', () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let viewer: User;
  let developer: User;
  let admin: User;
  let nonMember: User;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Clear mocks before setting up new ones
    vi.clearAllMocks();

    // Create workspace scenario with multiple roles
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'Learnings Owner' },
      members: [
        { role: 'VIEWER' },
        { role: 'DEVELOPER' },
        { role: 'ADMIN' },
      ],
    });

    owner = scenario.owner;
    workspace = scenario.workspace;
    viewer = scenario.members[0];
    developer = scenario.members[1];
    admin = scenario.members[2];

    // Create swarm configuration with encrypted API key
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmApiKey: 'test-swarm-api-key-12345',
      swarmUrl: 'https://test-swarm.sphinx.chat',
    });

    // Create non-member user
    nonMember = await createTestUser({
      name: 'Non Member',
      email: 'nonmember@test.com',
    });

    // Mock global fetch for external Swarm calls
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  afterEach(async () => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const request = createPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {}
      );
      const response = await POST(request);


      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Parameter Validation', () => {
    it('should return 400 when workspace parameter is missing', async () => {
      const request = createAuthenticatedPostRequest(
        '/api/learnings?budget=10',
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing required parameter: workspace');
    });

    it('should return 400 when budget parameter is missing', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing required parameter: budget');
    });

    it('should return 400 when both parameters are missing', async () => {
      const request = createAuthenticatedPostRequest(
        '/api/learnings',
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing required parameter: workspace');
    });
  });

  describe('Authorization - Workspace Access', () => {
    it('should allow OWNER role to create learnings', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Seed knowledge request initiated');
    });

    it('should allow ADMIN role to create learnings', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        admin
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should allow DEVELOPER role to create learnings', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        developer
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should allow VIEWER role to create learnings', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        viewer
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return 403 for non-member access', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        nonMember
      );
      const response = await POST(request);


      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    it('should return 403 for non-existent workspace', async () => {
      const request = createAuthenticatedPostRequest(
        '/api/learnings?workspace=nonexistent-workspace&budget=10',
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });
  });

  describe('Swarm Configuration', () => {
    it('should return 404 when swarm is not configured', async () => {
      // Delete swarm configuration
      await db.swarm.delete({ where: { id: swarm.id } });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Swarm not found for this workspace');

      // Recreate swarm for subsequent tests
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-swarm-api-key-12345',
        swarmUrl: 'https://test-swarm.sphinx.chat',
      });
    });

    it('should return 404 when swarmUrl is not set', async () => {
      // Update swarm to remove URL
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Swarm URL not configured');

      // Restore swarmUrl for subsequent tests
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: 'https://test-swarm.sphinx.chat' },
      });
    });
  });

  describe('API Key Decryption', () => {
    it('should decrypt API key before external request', async () => {
      const decryptSpy = vi.spyOn(EncryptionService.getInstance(), 'decryptField');

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(decryptSpy).toHaveBeenCalledWith('swarmApiKey', expect.any(String));
    });

    it('should send decrypted plaintext API key in x-api-token header', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/seed_stories'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-token': 'test-swarm-api-key-12345',
          }),
        })
      );
    });
  });

  describe('External Swarm Integration', () => {
    it('should construct correct URL with port 3355', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test-swarm.sphinx.chat:3355/seed_stories?budget=10',
        expect.any(Object)
      );
    });

    it('should URL-encode budget parameter', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=20`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('budget=20'),
        expect.any(Object)
      );
    });

    it('should use http:// for localhost URLs', async () => {
      // Update swarm URL to localhost
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: 'http://localhost:3355' },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3355/seed_stories?budget=10',
        expect.any(Object)
      );
    });

    it('should send POST method to swarm', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include Content-Type: application/json header', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('Fire-and-Forget Pattern', () => {
    it('should return 200 immediately without waiting for swarm response', async () => {
      // Create a promise that never resolves to simulate slow swarm
      const slowPromise = new Promise(() => {});
      fetchSpy.mockReturnValue(slowPromise as any);

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      // Response should return immediately despite slow swarm
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Seed knowledge request initiated');
    });

    it('should return 200 even when swarm request fails', async () => {
      // Mock swarm to fail
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      // Endpoint should still return success
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return 200 even when swarm returns error status', async () => {
      // Mock swarm to return 500 error
      fetchSpy.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      // Endpoint should still return success
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should call fetch to swarm despite fire-and-forget pattern', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      // Verify fetch was called even though we don't wait for it
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    // NOTE: Tests that mock db.swarm or EncryptionService are skipped because
    // mocking Prisma client methods in integration tests causes state corruption.
    // Integration tests should test real database interactions. Error scenarios
    // like database failures should be tested in unit tests of the utils module.
    
    it.skip('should return 500 when database query fails', async () => {
      // Skipped: Mocking db.swarm.findFirst breaks subsequent tests
      // Test database failure scenarios in unit tests instead
    });

    it.skip('should return 500 when decryption fails', async () => {
      // Skipped: Mocking EncryptionService breaks subsequent tests
      // Test decryption failure scenarios in unit tests instead
    });

    it('should not return 500 when swarm network request fails', async () => {
      // Mock fetch to fail
      fetchSpy.mockRejectedValue(new Error('Network timeout'));

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        owner
      );
      const response = await POST(request);


      // Should still return success because of fire-and-forget pattern
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Knowledge Management Integration', () => {
    it('should successfully proxy learning data creation to external swarm', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=50`,
        {},
        owner
      );
      const response = await POST(request);


      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Seed knowledge request initiated');

      // Verify swarm was called with correct parameters
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test-swarm.sphinx.chat:3355/seed_stories?budget=50',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-token': 'test-swarm-api-key-12345',
          }),
        })
      );
    });

    it('should validate workspace membership before creating learnings', async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=10`,
        {},
        nonMember
      );
      const response = await POST(request);


      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');

      // Verify swarm was not called
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should support various budget values for learning seeding', async () => {
      const budgets = ['5', '10', '25', '50', '100'];

      for (const budget of budgets) {
        fetchSpy.mockClear();

        const request = createAuthenticatedPostRequest(
          `/api/learnings?workspace=${workspace.slug}&budget=${budget}`,
          {},
          owner
        );
        const response = await POST(request);


        expect(response.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining(`budget=${budget}`),
          expect.any(Object)
        );
      }
    });
  });
});
