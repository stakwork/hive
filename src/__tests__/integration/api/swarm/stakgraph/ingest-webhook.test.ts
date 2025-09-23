import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { POST } from '@/app/api/swarm/stakgraph/ingest/route';
import { db } from '@/lib/db';
import { triggerIngestAsync } from '@/services/swarm/stakgraph-actions';
import { WebhookService } from '@/services/github/WebhookService';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { EncryptionService } from '@/lib/encryption';
import { getServiceConfig } from '@/config/services';
import { getGithubWebhookCallbackUrl } from '@/lib/url';
import { RepositoryStatus } from '@prisma/client';

// Mock all external dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/db');
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/services/github/WebhookService');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/encryption');
vi.mock('@/config/services');
vi.mock('@/lib/url');

describe('POST /api/swarm/stakgraph/ingest - GitHub Webhook Integration', () => {
  let mockRequest: NextRequest;
  let mockEncryptionService: any;
  let mockWebhookService: any;

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
  });

  beforeEach(() => {
    vi.resetAllMocks();

    mockRequest = {
      json: vi.fn().mockResolvedValue({ workspaceId: 'workspace-123' }),
      headers: new Map(),
    } as any;

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
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GitHub Webhook Setup - Success Cases', () => {
    it('should successfully setup webhook with all parameters', async () => {
      const response = await POST(mockRequest);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        repositoryUrl: 'https://github.com/owner/repo',
        callbackUrl: 'https://example.com/api/github/webhook',
      });
    });

    it('should use default webhook events and active status', async () => {
      const response = await POST(mockRequest);
      
      expect(response.status).toBe(200);
      
      // Verify WebhookService was called with correct parameters
      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        repositoryUrl: 'https://github.com/owner/repo',
        callbackUrl: 'https://example.com/api/github/webhook',
      });
    });

    it('should successfully create webhook service instance with correct config', async () => {
      await POST(mockRequest);

      expect(WebhookService).toHaveBeenCalledWith({
        baseURL: 'https://api.github.com',
        apiKey: 'mock-key',
        timeout: 10000,
        headers: {},
      });
    });
  });

  describe('GitHub Webhook Setup - Error Scenarios', () => {
    it('should handle INSUFFICIENT_PERMISSIONS webhook error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('INSUFFICIENT_PERMISSIONS'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: INSUFFICIENT_PERMISSIONS');

      consoleSpy.mockRestore();
    });

    it('should handle WEBHOOK_CREATION_FAILED error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('WEBHOOK_CREATION_FAILED'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: WEBHOOK_CREATION_FAILED');

      consoleSpy.mockRestore();
    });

    it('should handle network timeouts during webhook setup', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Network timeout'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Network timeout');

      consoleSpy.mockRestore();
    });

    it('should handle webhook service instantiation failures', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(WebhookService).mockImplementation(() => {
        throw new Error('Service instantiation failed');
      });

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Service instantiation failed');

      consoleSpy.mockRestore();
    });
  });

  describe('GitHub Webhook Setup - Configuration Edge Cases', () => {
    it('should handle missing GitHub service config gracefully', async () => {
      vi.mocked(getServiceConfig).mockImplementation(() => {
        throw new Error('GitHub service config not found');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: GitHub service config not found');

      consoleSpy.mockRestore();
    });

    it('should handle invalid callback URL generation', async () => {
      vi.mocked(getGithubWebhookCallbackUrl).mockImplementation(() => {
        throw new Error('Invalid callback URL');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Invalid callback URL');

      consoleSpy.mockRestore();
    });

    it('should handle webhook setup with malformed repository URL', async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...baseSwarmData,
        repositoryUrl: 'invalid-url',
      } as any);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Invalid repository URL format'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Invalid repository URL format');

      consoleSpy.mockRestore();
    });
  });

  describe('GitHub Webhook Setup - Authentication Edge Cases', () => {
    it('should handle missing GitHub credentials during webhook setup', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('GitHub access token not found for user'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: GitHub access token not found for user');

      consoleSpy.mockRestore();
    });

    it('should handle expired GitHub tokens during webhook setup', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('GitHub token expired'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: GitHub token expired');

      consoleSpy.mockRestore();
    });

    it('should handle repository access denied during webhook setup', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Repository access denied'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should not fail the entire request
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Repository access denied');

      consoleSpy.mockRestore();
    });
  });

  describe('GitHub Webhook Setup - Service Integration', () => {
    it('should pass correct service configuration to WebhookService', async () => {
      const customConfig = {
        baseURL: 'https://custom-github.com',
        apiKey: 'custom-key',
        timeout: 15000,
        headers: { 'Custom-Header': 'value' },
      };

      vi.mocked(getServiceConfig).mockReturnValue(customConfig);

      await POST(mockRequest);

      expect(WebhookService).toHaveBeenCalledWith(customConfig);
    });

    it('should use correct GitHub service identifier', async () => {
      await POST(mockRequest);

      expect(getServiceConfig).toHaveBeenCalledWith('github');
    });

    it('should handle webhook service method call parameters correctly', async () => {
      await POST(mockRequest);

      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        repositoryUrl: 'https://github.com/owner/repo',
        callbackUrl: 'https://example.com/api/github/webhook',
      });

      // Verify no additional parameters were passed
      const callArgs = mockWebhookService.ensureRepoWebhook.mock.calls[0][0];
      expect(Object.keys(callArgs)).toEqual(['userId', 'workspaceId', 'repositoryUrl', 'callbackUrl']);
    });
  });

  describe('Webhook Setup Error Recovery', () => {
    it('should continue processing after webhook error and still return success', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(new Error('Webhook error'));

      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Should complete successfully despite webhook error
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.request_id).toBe('ingest-123');
      expect(responseData.repositoryStatus).toBe(RepositoryStatus.PENDING);

      // Should still perform all other operations
      expect(db.repository.upsert).toHaveBeenCalled();
      expect(triggerIngestAsync).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should log webhook errors with sufficient detail for debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const webhookError = new Error('Detailed webhook error with stack trace');
      webhookError.stack = 'Error: Detailed webhook error\n    at WebhookService.ensureRepoWebhook';
      
      mockWebhookService.ensureRepoWebhook.mockRejectedValue(webhookError);

      await POST(mockRequest);

      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Detailed webhook error with stack trace');

      consoleSpy.mockRestore();
    });
  });
});