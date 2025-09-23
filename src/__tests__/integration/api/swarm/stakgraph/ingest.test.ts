import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { POST } from '@/app/api/swarm/stakgraph/ingest/route';
import { db } from '@/lib/db';
import { triggerIngestAsync } from '@/services/swarm/stakgraph-actions';
import { WebhookService } from '@/services/github/WebhookService';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { EncryptionService } from '@/lib/encryption';
import { getServiceConfig } from '@/config/services';
import { getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from '@/lib/url';
import { getSwarmVanityAddress } from '@/lib/constants';
import { RepositoryStatus } from '@prisma/client';

// Mock all external dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/db');
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/services/github/WebhookService');
vi.mock('@/services/swarm/db');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/encryption');
vi.mock('@/config/services');
vi.mock('@/lib/url');
vi.mock('@/lib/constants');

describe('POST /api/swarm/stakgraph/ingest - Integration Tests', () => {
  let mockRequest: NextRequest;
  let mockEncryptionService: any;
  let mockWebhookService: any;

  beforeAll(() => {
    // Setup global mocks
    mockEncryptionService = {
      decryptField: vi.fn(),
      encryptField: vi.fn(),
    };

    mockWebhookService = {
      ensureRepoWebhook: vi.fn(),
    };

    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService);
    vi.mocked(WebhookService).mockImplementation(() => mockWebhookService);
    vi.mocked(getServiceConfig).mockReturnValue({
      baseURL: 'https://api.github.com',
      apiKey: 'mock-key',
      timeout: 10000,
      headers: {},
    });
    vi.mocked(getGithubWebhookCallbackUrl).mockReturnValue('https://example.com/api/github/webhook');
    vi.mocked(getStakgraphWebhookCallbackUrl).mockReturnValue('https://example.com/api/swarm/stakgraph/webhook');
    vi.mocked(getSwarmVanityAddress).mockImplementation((name) => `${name}.sphinx.chat`);
  });

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Create mock request
    mockRequest = {
      json: vi.fn(),
      headers: new Map(),
    } as any;

    // Default successful mocks
    vi.mocked(mockRequest.json).mockResolvedValue({
      workspaceId: 'workspace-123',
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123' },
    } as any);

    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      id: 'swarm-123',
      workspaceId: 'workspace-123',
      name: 'test-swarm',
      swarmUrl: 'https://test-swarm.sphinx.chat',
      swarmApiKey: 'encrypted-api-key',
      repositoryUrl: 'https://github.com/owner/repo',
      defaultBranch: 'main',
    } as any);

    vi.mocked(db.repository.upsert).mockResolvedValue({
      id: 'repo-123',
      name: 'repo',
      repositoryUrl: 'https://github.com/owner/repo',
      workspaceId: 'workspace-123',
      status: RepositoryStatus.PENDING,
      branch: 'main',
    } as any);

    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      slug: 'test-workspace',
    } as any);

    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: 'test-user',
      token: 'github-token',
    });

    mockEncryptionService.decryptField.mockReturnValue('decrypted-api-key');

    vi.mocked(triggerIngestAsync).mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: 'ingest-123' },
    });

    mockWebhookService.ensureRepoWebhook.mockResolvedValue({
      id: 12345,
      secret: 'webhook-secret',
    });

    vi.mocked(saveOrUpdateSwarm).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Success Scenarios', () => {
    it('should successfully trigger code ingestion with workspaceId', async () => {
      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.request_id).toBe('ingest-123');
      expect(responseData.repositoryStatus).toBe(RepositoryStatus.PENDING);

      // Verify authentication check
      expect(getServerSession).toHaveBeenCalled();

      // Verify swarm lookup
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
      });

      // Verify repository upsertion
      expect(db.repository.upsert).toHaveBeenCalledWith({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: 'https://github.com/owner/repo',
            workspaceId: 'workspace-123',
          },
        },
        update: { status: RepositoryStatus.PENDING },
        create: {
          name: 'repo',
          repositoryUrl: 'https://github.com/owner/repo',
          workspaceId: 'workspace-123',
          status: RepositoryStatus.PENDING,
          branch: 'main',
        },
      });

      // Verify workspace lookup for GitHub credentials
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'workspace-123' },
        select: { slug: true },
      });

      // Verify GitHub credentials retrieval
      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith('user-123', 'test-workspace');

      // Verify code ingestion trigger
      expect(triggerIngestAsync).toHaveBeenCalledWith(
        'test-swarm.sphinx.chat',
        'decrypted-api-key',
        'https://github.com/owner/repo',
        { username: 'test-user', pat: 'github-token' },
        'https://example.com/api/swarm/stakgraph/webhook'
      );

      // Verify GitHub webhook setup
      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        repositoryUrl: 'https://github.com/owner/repo',
        callbackUrl: 'https://example.com/api/github/webhook',
      });

      // Verify swarm ingestRefId update
      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: 'workspace-123',
        ingestRefId: 'ingest-123',
      });
    });

    it('should successfully trigger code ingestion with swarmId', async () => {
      vi.mocked(mockRequest.json).mockResolvedValue({
        swarmId: 'swarm-123',
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify swarm lookup with swarmId
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: 'swarm-123' },
      });
    });

    it('should handle successful ingestion without GitHub credentials', async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify code ingestion called with empty credentials
      expect(triggerIngestAsync).toHaveBeenCalledWith(
        'test-swarm.sphinx.chat',
        'decrypted-api-key',
        'https://github.com/owner/repo',
        { username: '', pat: '' },
        'https://example.com/api/swarm/stakgraph/webhook'
      );
    });

    it('should continue successfully even if webhook setup fails', async () => {
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Webhook setup failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Webhook setup failed');

      consoleSpy.mockRestore();
    });

    it('should handle API result without request_id', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { message: 'Success but no request_id' },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify saveOrUpdateSwarm was not called when no request_id
      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
    });
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Unauthorized');

      // Verify no further operations were attempted
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
    });

    it('should return 401 for sessions without user ID', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {},
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Unauthorized');
    });
  });

  describe('Swarm Validation', () => {
    it('should return 404 when swarm not found', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Swarm not found');
    });

    it('should return 400 when swarm URL is missing', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: 'swarm-123',
        swarmUrl: null,
        swarmApiKey: 'encrypted-api-key',
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Swarm URL or API key not set');
    });

    it('should return 400 when swarm API key is missing', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: 'swarm-123',
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: null,
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Swarm URL or API key not set');
    });

    it('should return 400 when repository URL is missing', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: 'swarm-123',
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'encrypted-api-key',
        repositoryUrl: null,
        defaultBranch: null,
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('No repository URL found');
    });
  });

  describe('Repository Operations', () => {
    it('should handle repository upsert with create operation', async () => {
      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.repositoryStatus).toBe(RepositoryStatus.PENDING);

      expect(db.repository.upsert).toHaveBeenCalledWith({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: 'https://github.com/owner/repo',
            workspaceId: 'workspace-123',
          },
        },
        update: { status: RepositoryStatus.PENDING },
        create: {
          name: 'repo',
          repositoryUrl: 'https://github.com/owner/repo',
          workspaceId: 'workspace-123',
          status: RepositoryStatus.PENDING,
          branch: 'main',
        },
      });
    });

    it('should handle repository upsert with update operation', async () => {
      // Mock existing repository
      vi.mocked(db.repository.upsert).mockResolvedValue({
        id: 'existing-repo-123',
        name: 'existing-repo',
        repositoryUrl: 'https://github.com/owner/repo',
        workspaceId: 'workspace-123',
        status: RepositoryStatus.PENDING,
        branch: 'main',
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.repositoryStatus).toBe(RepositoryStatus.PENDING);
    });

    it('should return 404 when workspace not found for repository operations', async () => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Workspace not found');
    });
  });

  describe('Code Ingestion', () => {
    it('should handle triggerIngestAsync API failures', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: 'Internal server error' },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.data.error).toBe('Internal server error');
    });

    it('should handle triggerIngestAsync with partial success', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: true,
        status: 202,
        data: { request_id: 'ingest-456', message: 'Processing started' },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(202);
      expect(responseData.success).toBe(true);
      expect(responseData.data.request_id).toBe('ingest-456');

      // Verify swarm was updated with ingest ref ID
      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: 'workspace-123',
        ingestRefId: 'ingest-456',
      });
    });

    it('should handle encryption service failures', async () => {
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('Database Operation Errors', () => {
    it('should handle swarm query failures', async () => {
      vi.mocked(db.swarm.findFirst).mockRejectedValue(new Error('Database connection failed'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle repository upsert failures', async () => {
      vi.mocked(db.repository.upsert).mockRejectedValue(new Error('Repository upsert failed'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle workspace query failures', async () => {
      vi.mocked(db.workspace.findUnique).mockRejectedValue(new Error('Workspace query failed'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle saveOrUpdateSwarm failures gracefully', async () => {
      vi.mocked(saveOrUpdateSwarm).mockRejectedValue(new Error('Swarm update failed'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    it('should handle malformed request body', async () => {
      vi.mocked(mockRequest.json).mockRejectedValue(new Error('Invalid JSON'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle missing GitHub credentials gracefully', async () => {
      vi.mocked(getGithubUsernameAndPAT).mockRejectedValue(new Error('GitHub credentials not found'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle both workspaceId and swarmId in request', async () => {
      vi.mocked(mockRequest.json).mockResolvedValue({
        workspaceId: 'workspace-123',
        swarmId: 'swarm-456',
      });

      const response = await POST(mockRequest);
      
      expect(response.status).toBe(200);
      
      // Should prefer swarmId over workspaceId
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: 'swarm-456' },
      });
    });

    it('should handle empty repository name gracefully', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: 'swarm-123',
        workspaceId: 'workspace-123',
        name: 'test-swarm',
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'encrypted-api-key',
        repositoryUrl: 'https://github.com/owner/',
        defaultBranch: 'main',
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Should use fallback name for repository
      expect(db.repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            name: 'https://github.com/owner/',
          }),
        })
      );
    });

    it('should handle triggerIngestAsync returning non-object data', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: true,
        status: 200,
        data: 'success',
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBe('success');

      // Should not call saveOrUpdateSwarm when data is not an object
      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    it('should handle missing default branch', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: 'swarm-123',
        workspaceId: 'workspace-123',
        name: 'test-swarm',
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'encrypted-api-key',
        repositoryUrl: 'https://github.com/owner/repo',
        defaultBranch: null,
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(db.repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            branch: '',
          }),
        })
      );
    });
  });

  describe('Logging and Error Reporting', () => {
    it('should log errors appropriately', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(db.swarm.findFirst).mockRejectedValue(new Error('Database error'));

      const response = await POST(mockRequest);
      
      expect(response.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should log webhook errors without failing the request', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Webhook error'));

      const response = await POST(mockRequest);
      
      expect(response.status).toBe(200);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Webhook error');

      consoleSpy.mockRestore();
    });
  });

  describe('Response Format Validation', () => {
    it('should return proper response structure for success', async () => {
      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(responseData).toHaveProperty('success');
      expect(responseData).toHaveProperty('status');
      expect(responseData).toHaveProperty('data');
      expect(responseData).toHaveProperty('repositoryStatus');
      
      expect(typeof responseData.success).toBe('boolean');
      expect(typeof responseData.status).toBe('number');
      expect(responseData.repositoryStatus).toBe(RepositoryStatus.PENDING);
    });

    it('should return proper error response structure', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(responseData).toHaveProperty('success');
      expect(responseData).toHaveProperty('message');
      
      expect(responseData.success).toBe(false);
      expect(typeof responseData.message).toBe('string');
    });
  });
});