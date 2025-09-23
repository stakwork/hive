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

describe('POST /api/swarm/stakgraph/ingest - Error Scenarios & Edge Cases', () => {
  let mockRequest: NextRequest;
  let mockEncryptionService: any;
  let mockWebhookService: any;
  let consoleSpy: any;

  const baseSwarmData = {
    id: 'swarm-123',
    workspaceId: 'workspace-123',
    name: 'test-swarm',
    swarmUrl: 'https://test-swarm.sphinx.chat',
    swarmApiKey: 'encrypted-api-key',
    repositoryUrl: 'https://github.com/owner/repo',
    defaultBranch: 'main',
  };

  beforeAll(() => {
    mockEncryptionService = {
      decryptField: vi.fn().mockReturnValue('decrypted-api-key'),
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
    vi.resetAllMocks();

    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRequest = {
      json: vi.fn().mockResolvedValue({ workspaceId: 'workspace-123' }),
      headers: new Map(),
    } as any;

    // Default successful setup
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123' },
    } as any);

    vi.mocked(db.swarm.findFirst).mockResolvedValue(baseSwarmData as any);
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
    consoleSpy.mockRestore();
    vi.resetAllMocks();
  });

  describe('Complex Database Failure Scenarios', () => {
    it('should handle database connection timeouts', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.name = 'TimeoutError';
      
      vi.mocked(db.swarm.findFirst).mockRejectedValue(timeoutError);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', timeoutError);
    });

    it('should handle database constraint violations during repository upsert', async () => {
      const constraintError = new Error('Unique constraint violation');
      constraintError.name = 'PrismaClientKnownRequestError';
      
      vi.mocked(db.repository.upsert).mockRejectedValue(constraintError);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle database transaction failures', async () => {
      const transactionError = new Error('Transaction rollback');
      
      vi.mocked(db.repository.upsert).mockRejectedValue(transactionError);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle partial database operations failure', async () => {
      // Swarm and repository operations succeed, but workspace query fails
      vi.mocked(db.workspace.findUnique).mockRejectedValue(new Error('Workspace query failed'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('External API Integration Failures', () => {
    it('should handle stakgraph API service unavailable', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: false,
        status: 503,
        data: { error: 'Service temporarily unavailable' },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(503);
      expect(responseData.success).toBe(false);
      expect(responseData.data.error).toBe('Service temporarily unavailable');
    });

    it('should handle stakgraph API rate limiting', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: false,
        status: 429,
        data: { error: 'Rate limit exceeded', retry_after: 60 },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(429);
      expect(responseData.success).toBe(false);
      expect(responseData.data.retry_after).toBe(60);
    });

    it('should handle stakgraph API authentication failures', async () => {
      vi.mocked(triggerIngestAsync).mockResolvedValue({
        ok: false,
        status: 401,
        data: { error: 'Invalid API key' },
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.success).toBe(false);
      expect(responseData.data.error).toBe('Invalid API key');
    });

    it('should handle stakgraph API network errors', async () => {
      vi.mocked(triggerIngestAsync).mockRejectedValue(new Error('Network unreachable'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('Encryption Service Failures', () => {
    it('should handle encryption key not found', async () => {
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Encryption key not found');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle corrupted encrypted data', async () => {
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Invalid encrypted data format');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle encryption service unavailable', async () => {
      vi.mocked(EncryptionService.getInstance).mockImplementation(() => {
        throw new Error('Encryption service unavailable');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('GitHub Integration Edge Cases', () => {
    it('should handle GitHub API being temporarily down', async () => {
      vi.mocked(getGithubUsernameAndPAT).mockRejectedValue(new Error('GitHub API unavailable'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle user without GitHub installation', async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should succeed with empty credentials
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(triggerIngestAsync).toHaveBeenCalledWith(
        'test-swarm.sphinx.chat',
        'decrypted-api-key',
        'https://github.com/owner/repo',
        { username: '', pat: '' },
        'https://example.com/api/swarm/stakgraph/webhook'
      );
    });

    it('should handle GitHub credentials with missing token', async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: 'test-user',
        token: null,
      } as any);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(triggerIngestAsync).toHaveBeenCalledWith(
        'test-swarm.sphinx.chat',
        'decrypted-api-key',
        'https://github.com/owner/repo',
        { username: 'test-user', pat: '' },
        'https://example.com/api/swarm/stakgraph/webhook'
      );
    });
  });

  describe('Configuration and URL Generation Failures', () => {
    it('should handle missing service configuration', async () => {
      vi.mocked(getServiceConfig).mockImplementation(() => {
        throw new Error('Service configuration not found');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should still succeed for main flow, only webhook would fail
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Service configuration not found');
    });

    it('should handle webhook URL generation failure', async () => {
      vi.mocked(getGithubWebhookCallbackUrl).mockImplementation(() => {
        throw new Error('Failed to generate callback URL');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should still succeed for main flow, only webhook would fail
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Failed to generate callback URL');
    });

    it('should handle stakgraph callback URL generation failure', async () => {
      vi.mocked(getStakgraphWebhookCallbackUrl).mockImplementation(() => {
        throw new Error('Failed to generate stakgraph callback URL');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle swarm vanity address generation failure', async () => {
      vi.mocked(getSwarmVanityAddress).mockImplementation(() => {
        throw new Error('Invalid swarm name for vanity address');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('Complex Multi-Service Failure Scenarios', () => {
    it('should handle cascading service failures', async () => {
      // Setup multiple failures
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Encryption failure');
      });
      
      vi.mocked(db.workspace.findUnique).mockRejectedValue(new Error('Database failure'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle partial success with multiple component failures', async () => {
      // Repository upsert succeeds, but other services fail
      vi.mocked(triggerIngestAsync).mockRejectedValue(new Error('Stakgraph failure'));
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Webhook failure'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');

      // Should still have attempted repository upsert
      expect(db.repository.upsert).toHaveBeenCalled();
    });

    it('should handle timeout during swarm ingestRefId update', async () => {
      vi.mocked(saveOrUpdateSwarm).mockRejectedValue(new Error('Operation timeout'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });
  });

  describe('Request Processing Edge Cases', () => {
    it('should handle request with null values', async () => {
      vi.mocked(mockRequest.json).mockResolvedValue({
        workspaceId: null,
        swarmId: null,
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Swarm not found');
    });

    it('should handle request with undefined workspaceId', async () => {
      vi.mocked(mockRequest.json).mockResolvedValue({
        workspaceId: undefined,
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Swarm not found');
    });

    it('should handle request body parsing errors', async () => {
      vi.mocked(mockRequest.json).mockRejectedValue(new SyntaxError('Unexpected token in JSON'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle extremely large request payloads', async () => {
      const largePayload = {
        workspaceId: 'workspace-123',
        additionalData: 'x'.repeat(10000), // Large string
      };

      vi.mocked(mockRequest.json).mockResolvedValue(largePayload);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should process normally despite large payload
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should handle out of memory conditions gracefully', async () => {
      const memoryError = new Error('JavaScript heap out of memory');
      memoryError.name = 'RangeError';
      
      vi.mocked(db.repository.upsert).mockRejectedValue(memoryError);

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');
    });

    it('should handle resource cleanup on errors', async () => {
      vi.mocked(triggerIngestAsync).mockRejectedValue(new Error('Resource exhaustion'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.message).toBe('Failed to ingest code');

      // Verify error was logged properly
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', expect.any(Error));
    });
  });
});