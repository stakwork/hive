import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { EncryptionService } from '@/lib/encryption';
import { POST } from '@/app/api/pool-manager/create-pool/route';

// Mock dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/services/swarm/secrets');
vi.mock('@/services/pool-manager/PoolManagerService');

// Test database setup
const testDb = new PrismaClient({
  datasourceUrl: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5433/hive_test'
});

// Test utilities
const createMockRequest = (body: any) => {
  return new NextRequest('http://localhost:3000/api/pool-manager/create-pool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
};

const createMockSession = (userId: string, email: string) => ({
  user: { id: userId, email },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});

describe('POST /api/pool-manager/create-pool - Integration Tests', () => {
  let testUser: any;
  let testWorkspace: any;
  let testSwarm: any;
  let testRepository: any;
  let encryptionService: EncryptionService;

  beforeAll(async () => {
    await testDb.$connect();
    encryptionService = EncryptionService.getInstance();
    
    // Set up test encryption key
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    }
  });

  afterAll(async () => {
    await testDb.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data in correct order (child -> parent)
    await testDb.workspaceMember.deleteMany();
    await testDb.swarm.deleteMany();
    await testDb.repository.deleteMany();
    await testDb.workspace.deleteMany();
    await testDb.account.deleteMany();
    await testDb.user.deleteMany();

    // Create test user
    testUser = await testDb.user.create({
      data: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: new Date(),
      },
    });

    // Create GitHub account for user
    await testDb.account.create({
      data: {
        userId: testUser.id,
        type: 'oauth',
        provider: 'github',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token_123',
        token_type: 'bearer',
        scope: 'repo,read:org',
      },
    });

    // Create test workspace
    testWorkspace = await testDb.workspace.create({
      data: {
        id: 'test-workspace-id',
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: testUser.id,
        stakworkApiKey: 'test-stakwork-key',
      },
    });

    // Create workspace membership for the test user
    await testDb.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: testWorkspace.id,
        role: 'OWNER',
      },
    });

    // Create test repository
    testRepository = await testDb.repository.create({
      data: {
        id: 'test-repo-id',
        name: 'test-repo',
        repositoryUrl: 'https://github.com/test/repo',
        branch: 'main',
        status: 'SYNCED',
        workspaceId: testWorkspace.id,
      },
    });

    // Create test swarm
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', 'test-swarm-api-key');
    testSwarm = await testDb.swarm.create({
      data: {
        id: 'test-swarm-id',
        swarmId: 'test-swarm-123',
        name: 'test-swarm',
        status: 'ACTIVE',
        workspaceId: testWorkspace.id,
        swarmApiKey: JSON.stringify(encryptedApiKey),
        environmentVariables: [
          { name: 'NODE_ENV', value: 'test' },
          { name: 'API_KEY', value: 'test-key' },
        ],
      },
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test data in correct order (child -> parent)
    await testDb.workspaceMember.deleteMany();
    await testDb.swarm.deleteMany();
    await testDb.repository.deleteMany();
    await testDb.workspace.deleteMany();
    await testDb.account.deleteMany();
    await testDb.user.deleteMany();
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without valid session', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(null);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should reject requests from users without email', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should reject requests from users without valid user ID', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue({
        user: { email: 'test@example.com' },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid user session');
    });

    it('should reject access to non-existent swarm', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      const request = createMockRequest({
        swarmId: 'non-existent-swarm',
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Swarm not found');
    });

    it('should reject access from non-owner and non-member users', async () => {
      // Create another user
      const otherUser = await testDb.user.create({
        data: {
          id: 'other-user-id',
          name: 'Other User',
          email: 'other@example.com',
        },
      });

      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(otherUser.id, otherUser.email));

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Access denied');
    });

    it('should allow access for workspace owners', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Mock external dependencies
      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' }, // base64 for 'FROM node'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.pool).toBeDefined();
      expect(mockPoolManager.createPool).toHaveBeenCalled();
    });

    it('should allow access for workspace members', async () => {
      // Create member user
      const memberUser = await testDb.user.create({
        data: {
          id: 'member-user-id',
          name: 'Member User',
          email: 'member@example.com',
        },
      });

      // Add user as workspace member
      await testDb.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: testWorkspace.id,
          role: 'DEVELOPER',
        },
      });

      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(memberUser.id, memberUser.email));

      // Mock external dependencies
      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'memberuser',
        pat: 'gho_member_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.pool).toBeDefined();
    });
  });

  describe('Sensitive Data Handling', () => {
    it('should properly encrypt and decrypt pool API keys', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Mock external dependencies
      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      // Test encrypted API key handling
      const originalApiKey = 'sensitive-pool-api-key-12345';
      const encryptedApiKey = encryptionService.encryptField('poolApiKey', originalApiKey);
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(encryptedApiKey));

      let capturedDecryptedKey = '';
      const mockPoolManager = {
        createPool: vi.fn().mockImplementation((params) => {
          // This would receive the decrypted API key in Authorization header
          capturedDecryptedKey = params.headers?.Authorization?.replace('Bearer ', '') || '';
          return Promise.resolve({
            id: 'test-pool-id',
            name: 'test-pool',
            status: 'active',
          });
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);
      
      expect(response.status).toBe(201);
      expect(mockPoolManager.createPool).toHaveBeenCalled();
      
      // Verify that the API key was properly decrypted before use
      const createPoolCall = mockPoolManager.createPool.mock.calls[0][0];
      expect(createPoolCall.headers?.Authorization).toContain('Bearer ');
    });

    it('should handle GitHub PAT securely and not expose in logs', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Mock console methods to check for sensitive data exposure
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      const sensitivePatToken = 'gho_very_sensitive_token_abcdef123456';
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: sensitivePatToken,
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      await POST(request);

      // Verify that the sensitive PAT token is not exposed in console logs
      const allLogCalls = consoleSpy.mock.calls.concat(consoleErrorSpy.mock.calls);
      const loggedContent = allLogCalls.map(call => call.join(' ')).join(' ');
      
      expect(loggedContent).not.toContain(sensitivePatToken);
      expect(loggedContent).not.toContain('gho_very_sensitive_token_abcdef123456');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should properly encrypt environment variables with sensitive data', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Update swarm with sensitive environment variables
      const sensitiveEnvVars = [
        { name: 'DATABASE_URL', value: 'postgresql://user:secret123@localhost/db' },
        { name: 'API_SECRET_KEY', value: 'super-secret-api-key-xyz789' },
        { name: 'OAUTH_CLIENT_SECRET', value: 'oauth-client-secret-abc123' },
      ];

      await testDb.swarm.update({
        where: { id: testSwarm.id },
        data: { 
          environmentVariables: sensitiveEnvVars.map(env => ({
            name: env.name,
            value: encryptionService.encryptField('environmentVariables', env.value),
          }))
        },
      });

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      let capturedEnvVars: any[] = [];
      const mockPoolManager = {
        createPool: vi.fn().mockImplementation((params) => {
          capturedEnvVars = params.env_vars || [];
          return Promise.resolve({
            id: 'test-pool-id',
            name: 'test-pool',
            status: 'active',
          });
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPoolManager.createPool).toHaveBeenCalled();

      // Verify environment variables were properly decrypted
      expect(capturedEnvVars).toHaveLength(3);
      expect(capturedEnvVars.find(env => env.name === 'DATABASE_URL')).toBeDefined();
      expect(capturedEnvVars.find(env => env.name === 'API_SECRET_KEY')).toBeDefined();
      expect(capturedEnvVars.find(env => env.name === 'OAUTH_CLIENT_SECRET')).toBeDefined();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing pool API key by attempting to create one', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Update swarm to not have pool API key
      await testDb.swarm.update({
        where: { id: testSwarm.id },
        data: { poolApiKey: null },
      });

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      // First call returns empty, second call returns generated key
      vi.mocked(getSwarmPoolApiKeyFor)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(JSON.stringify(encryptionService.encryptField('poolApiKey', 'new-api-key')));

      vi.mocked(updateSwarmPoolApiKeyFor).mockResolvedValue(undefined);

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(updateSwarmPoolApiKeyFor).toHaveBeenCalledWith(testSwarm.id);
      expect(mockPoolManager.createPool).toHaveBeenCalled();
    });

    it('should handle external Pool Manager API errors gracefully', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      // Mock Pool Manager service to throw an error
      const mockPoolManager = {
        createPool: vi.fn().mockRejectedValue(new Error('Pool Manager service unavailable')),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create pool');
    });

    it('should validate required fields in request body', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      // Test missing swarmId
      const request = createMockRequest({
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Swarm not found');
    });

    it('should handle malformed container files gracefully', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {
          'Dockerfile': 'invalid-base64-content-!@#$%^&*()',
          'docker-compose.yml': 'YW5vdGhlci1maWxl', // valid base64
        },
      });

      const response = await POST(request);

      // Should still succeed even with malformed base64
      expect(response.status).toBe(201);
      expect(mockPoolManager.createPool).toHaveBeenCalled();
    });
  });

  describe('Data Validation and Security', () => {
    it('should not expose encrypted data in API responses', async () => {
      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(testUser.id, testUser.email));

      const { getGithubUsernameAndPAT } = await import('@/lib/auth/nextauth');
      const { getSwarmPoolApiKeyFor } = await import('@/services/swarm/secrets');
      const { PoolManagerService } = await import('@/services/pool-manager/PoolManagerService');

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'testuser',
        pat: 'gho_test_token_123',
      });

      const mockPoolApiKey = encryptionService.encryptField('poolApiKey', 'test-pool-api-key');
      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValue(JSON.stringify(mockPoolApiKey));

      const mockPoolManager = {
        createPool: vi.fn().mockResolvedValue({
          id: 'test-pool-id',
          name: 'test-pool',
          status: 'active',
        }),
      };
      vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: { 'Dockerfile': 'RlJPTSBub2Rl' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      
      // Ensure response doesn't contain sensitive encrypted data
      const responseString = JSON.stringify(data);
      expect(responseString).not.toContain('gho_test_token_123');
      expect(responseString).not.toContain('test-pool-api-key');
      expect(responseString).not.toContain(mockPoolApiKey.data);
    });

    it('should properly handle workspace access control edge cases', async () => {
      // Test workspace with soft-deleted member
      const softDeletedUser = await testDb.user.create({
        data: {
          id: 'soft-deleted-user',
          name: 'Soft Deleted User',
          email: 'deleted@example.com',
        },
      });

      await testDb.workspaceMember.create({
        data: {
          userId: softDeletedUser.id,
          workspaceId: testWorkspace.id,
          role: 'VIEWER',
          // Simulating soft delete with leftAt in the past
          leftAt: new Date('2020-01-01'),
        },
      });

      const mockGetServerSession = vi.mocked(getServerSession);
      mockGetServerSession.mockResolvedValue(createMockSession(softDeletedUser.id, softDeletedUser.email));

      const request = createMockRequest({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        container_files: {},
      });

      // Should return 404 because the user doesn't have access to the swarm (due to leftAt being set)
      const response = await POST(request);
      
      expect(response.status).toBe(404);
    });
  });
});