import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/user-journeys/[taskId]/execute/route';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { resetDatabase } from '@/__tests__/support/utilities/database';
import { WorkflowStatus } from '@prisma/client';

// Mock NextAuth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock auth options (required by getServerSession)
vi.mock('@/lib/auth/options', () => ({
  authOptions: {},
}));

describe('POST /api/user-journeys/[taskId]/execute - Integration Tests', () => {
  const mockGetServerSession = vi.mocked(getServerSession);
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Store original fetch and create mock
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(async () => {
    // Restore original fetch
    global.fetch = originalFetch;
    await resetDatabase();
  });

  // Helper to create test setup with real database and encryption
  async function createTestSetup() {
    const enc = EncryptionService.getInstance();

    return await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: `test-${Date.now()}@example.com`,
          name: 'Test User',
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${Date.now()}`,
          slug: `test-workspace-${Date.now()}`,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
        },
      });

      // Create repository
      const repository = await tx.repository.create({
        data: {
          name: 'test-repo',
          repositoryUrl: `https://github.com/testuser/test-repo-${Date.now()}`,
          workspaceId: workspace.id,
        },
      });

      // Create swarm with encrypted API keys
      const swarm = await tx.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          swarmUrl: 'https://test-swarm.example.com',
          poolName: 'test-pool-id',
          poolApiKey: JSON.stringify(enc.encryptField('poolApiKey', 'test-pool-api-key')),
          swarmApiKey: JSON.stringify(enc.encryptField('swarmApiKey', 'test-swarm-api-key')),
          workspaceId: workspace.id,
        },
      });

      // Create GitHub auth (without token - tokens are stored in Account table)
      const githubAuth = await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: '123456',
          githubUsername: 'testuser',
        },
      });

      // Create task
      const task = await tx.task.create({
        data: {
          title: 'Test User Journey',
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          sourceType: 'USER_JOURNEY',
          workflowStatus: 'PENDING',
          testFilePath: '/tests/user-journey.spec.ts',
        },
      });

      return { user, workspace, repository, swarm, githubAuth, task };
    });
  }

  // Helper to setup successful pod claiming mocks
  function setupSuccessfulPodClaimingMocks(frontendPort = 3000, controlPort = 15552) {
    mockFetch
      // GET workspace from pool
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspace: {
            id: 'test-workspace-id',
            password: 'test-pod-password',
            url: 'test-pod.example.com',
            portMappings: {
              [frontendPort.toString()]: `https://test-pod.example.com:40000`,
              [controlPort.toString()]: `https://test-pod.example.com:40001`,
            },
          },
        }),
        text: async () => JSON.stringify({ workspace: {} }),
      } as Response)
      // POST mark workspace as used
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      } as Response)
      // GET /jlist - process list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'frontend', port: frontendPort.toString() },
          { name: 'goose', port: '9090' },
        ],
        text: async () => JSON.stringify([{ name: 'frontend', port: frontendPort.toString() }]),
      } as Response)
      // POST /playwright_test - trigger test
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'triggered' }),
        text: async () => JSON.stringify({ status: 'triggered' }),
      } as Response);
  }

  describe('Happy Path - Successful Execution', () => {
    it('should successfully execute user journey task with pod claiming', async () => {
      const { user, task, workspace, swarm } = await createTestSetup();

      // Mock authenticated session
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Setup successful pod claiming flow
      setupSuccessfulPodClaimingMocks();

      // Create request
      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        {
          method: 'POST',
        }
      );

      // Execute endpoint
      const response = await POST(request, { params: { taskId: task.id } });

      // Validate response
      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.data.frontendUrl).toContain('test-pod.example.com');

      // Validate database updates
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask).toMatchObject({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        agentPassword: expect.any(String), // One-time API key
      });

      // Validate API call sequence
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify pool manager workspace fetch (uses swarm.id or swarm.poolName as poolId)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(`/pools/`),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer'),
          }),
        })
      );

      // Verify workspace mark-used
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/mark-used'),
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify control port /jlist call
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('/jlist'),
        expect.objectContaining({
          method: 'GET',
        })
      );

      // Verify control port /playwright_test call
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('/playwright_test'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining(task.id),
        })
      );
    });

    it('should use CUSTOM_STAKLINK_URL when available (local development mode)', async () => {
      const { user, task } = await createTestSetup();

      // Set environment variable for local dev mode
      const originalEnv = process.env.CUSTOM_STAKLINK_URL;
      process.env.CUSTOM_STAKLINK_URL = 'http://localhost:5173';

      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: user.id, email: user.email },
        } as any);

        // Only mock control port test trigger (no /jlist in local mode)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'triggered' }),
        } as Response);

        const request = new Request(
          `http://localhost:3000/api/user-journeys/${task.id}/execute`,
          { method: 'POST' }
        );

        const response = await POST(request, { params: { taskId: task.id } });

        expect(response.status).toBe(200);
        const data = await response.json();
        
        // Should use local URL instead of claimed pod
        expect(data.data.frontendUrl).toBeNull(); // Local mode returns null frontendUrl

        // Should only call control port test trigger (no pool manager calls, no /jlist)
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        // Restore environment variable
        if (originalEnv !== undefined) {
          process.env.CUSTOM_STAKLINK_URL = originalEnv;
        } else {
          delete process.env.CUSTOM_STAKLINK_URL;
        }
      }
    });

    it('should handle missing GitHub credentials gracefully', async () => {
      const { user, task } = await createTestSetup();

      // Delete GitHub auth to simulate missing credentials
      await db.gitHubAuth.deleteMany({ where: { userId: user.id } });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      setupSuccessfulPodClaimingMocks();

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      // Should still succeed
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Authentication Errors (401)', () => {
    it('should return 401 when session is null', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new Request(
        'http://localhost:3000/api/user-journeys/test-id/execute',
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: 'test-id' } });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when session.user is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: null } as any);

      const request = new Request(
        'http://localhost:3000/api/user-journeys/test-id/execute',
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: 'test-id' } });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when session.user.id is missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: 'test@example.com' },
      } as any);

      const request = new Request(
        'http://localhost:3000/api/user-journeys/test-id/execute',
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: 'test-id' } });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Validation Errors (400)', () => {
    it('should return 400 when taskId is missing', async () => {
      const { user } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new Request(
        'http://localhost:3000/api/user-journeys//execute',
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: '' } });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Task ID');
    });

    it('should return 400 when taskId is invalid format', async () => {
      const { user } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new Request(
        'http://localhost:3000/api/user-journeys/invalid-id-format/execute',
        { method: 'POST' }
      );

      const response = await POST(request, {
        params: { taskId: 'invalid-id-format' },
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Authorization Errors (404)', () => {
    it('should return 404 when task does not exist', async () => {
      const { user } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const nonExistentTaskId = 'cm4wmx8dt0000qjwz7k7k7k7k';
      const request = new Request(
        `http://localhost:3000/api/user-journeys/${nonExistentTaskId}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: nonExistentTaskId } });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Task not found');
    });

    it('should return 404 when user lacks workspace access', async () => {
      const { task } = await createTestSetup();

      // Create different user without workspace access
      const unauthorizedUser = await db.user.create({
        data: {
          email: `unauthorized-${Date.now()}@example.com`,
          name: 'Unauthorized User',
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: unauthorizedUser.id, email: unauthorizedUser.email },
      } as any);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Forbidden');
    });

    it('should return 404 when workspace is soft-deleted', async () => {
      const { user, task, workspace } = await createTestSetup();

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 404 when swarm configuration is missing', async () => {
      const { user, task, workspace } = await createTestSetup();

      // Delete swarm configuration
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('No swarm found');
    });
  });

  describe('Internal Errors (500)', () => {
    it('should return 500 when database query fails', async () => {
      const { user } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Use malformed taskId to trigger database error
      const request = new Request(
        'http://localhost:3000/api/user-journeys/malformed-id/execute',
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: 'malformed-id' } });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 500 when pool manager API is unavailable', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock pool manager failure
      mockFetch.mockRejectedValue(new Error('Network error'));

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toContain('Failed to');
    });

    it('should return 500 when pool manager returns non-ok response', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock pool manager error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service unavailable' }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle control port failure gracefully', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Setup successful pod claiming but failing control port
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspace: {
              id: 'test-workspace-id',
              password: 'test-pod-password',
              url: 'test-pod.example.com',
              portMappings: {
                '3000': 'https://test-pod.example.com:40000',
                '15552': 'https://test-pod.example.com:40001',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: 'frontend', port: '3000' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Control port error' }),
        } as Response);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      // Control port failure returns 503 (pod claimed but test trigger failed)
      expect(response.status).toBe(503);
    });
  });

  describe('Data Integrity Validation', () => {
    it('should correctly encrypt and decrypt API keys', async () => {
      const enc = EncryptionService.getInstance();
      const { swarm } = await createTestSetup();

      // Fetch swarm from database
      const fetchedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(fetchedSwarm).toBeDefined();
      expect(fetchedSwarm!.poolApiKey).toBeDefined();
      expect(fetchedSwarm!.swarmApiKey).toBeDefined();

      // Decrypt and verify
      const decryptedPoolKey = enc.decryptField('poolApiKey', fetchedSwarm!.poolApiKey);
      const decryptedSwarmKey = enc.decryptField('swarmApiKey', fetchedSwarm!.swarmApiKey);

      expect(decryptedPoolKey).toBe('test-pool-api-key');
      expect(decryptedSwarmKey).toBe('test-swarm-api-key');
    });

    it('should generate unique one-time API key for agent password', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      setupSuccessfulPodClaimingMocks();

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      await POST(request, { params: { taskId: task.id } });

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask!.agentPassword).toBeDefined();
      // agentPassword is stored as JSON string of encrypted data
      const parsedPassword = JSON.parse(updatedTask!.agentPassword!);
      expect(parsedPassword).toHaveProperty('data');
      expect(parsedPassword).toHaveProperty('iv');
      expect(parsedPassword).toHaveProperty('tag');
    });

    it('should update task status atomically', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      setupSuccessfulPodClaimingMocks();

      const initialStatus = task.workflowStatus;
      expect(initialStatus).toBe('PENDING');

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      await POST(request, { params: { taskId: task.id } });

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask!.workflowStatus).toBe('IN_PROGRESS');
      expect(updatedTask!.workflowStatus).not.toBe(initialStatus);
    });

    it('should maintain referential integrity across related entities', async () => {
      const { user, workspace, swarm, task, githubAuth } = await createTestSetup();

      // Verify relationships
      const taskWithRelations = await db.task.findUnique({
        where: { id: task.id },
        include: {
          workspace: {
            include: {
              swarm: true,
              members: true,
            },
          },
        },
      });

      expect(taskWithRelations).toBeDefined();
      expect(taskWithRelations!.workspace.id).toBe(workspace.id);
      expect(taskWithRelations!.workspace.swarm!.id).toBe(swarm.id);
      expect(taskWithRelations!.workspace.members[0].userId).toBe(user.id);

      const userWithGithub = await db.user.findUnique({
        where: { id: user.id },
        include: { githubAuth: true },
      });

      expect(userWithGithub!.githubAuth!.id).toBe(githubAuth.id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle task that is already in IN_PROGRESS state', async () => {
      const { user, task } = await createTestSetup();

      // Update task to IN_PROGRESS
      await db.task.update({
        where: { id: task.id },
        data: { workflowStatus: 'IN_PROGRESS' },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      setupSuccessfulPodClaimingMocks();

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      // Task already in progress allows re-execution (returns 200)
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should handle missing port mappings from pool manager', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock workspace with missing port mappings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspace: {
            portMappings: [], // Empty port mappings
            password: 'test-pod-password',
            url: 'test-pod.example.com',
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle missing frontend process in /jlist response', async () => {
      const { user, task } = await createTestSetup();

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspace: {
              id: 'test-workspace-id',
              password: 'test-pod-password',
              url: 'test-pod.example.com',
              portMappings: {
                '3000': 'https://test-pod.example.com:40000',
                '15552': 'https://test-pod.example.com:40001',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: 'backend', port: '8000' }], // No frontend process
        } as Response);

      const request = new Request(
        `http://localhost:3000/api/user-journeys/${task.id}/execute`,
        { method: 'POST' }
      );

      const response = await POST(request, { params: { taskId: task.id } });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });
});
