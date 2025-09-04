import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { POST } from '@/app/api/swarm/stakgraph/ingest/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { WebhookService } from '@/services/github/WebhookService';
import { swarmApiRequest } from '@/services/swarm/api/swarm';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { RepositoryStatus, SwarmStatus } from '@prisma/client';

// Mock external dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/db');
vi.mock('@/lib/encryption');
vi.mock('@/services/github/WebhookService');
vi.mock('@/services/swarm/api/swarm');
vi.mock('@/services/swarm/db');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/url', () => ({
  getGithubWebhookCallbackUrl: vi.fn(() => 'https://test.com/api/github/webhook'),
  getStakgraphWebhookCallbackUrl: vi.fn(() => 'https://test.com/api/swarm/stakgraph/webhook'),
}));
vi.mock('@/lib/constants', () => ({
  getSwarmVanityAddress: vi.fn((name: string) => `${name}.sphinx.chat`),
}));

describe('/api/swarm/stakgraph/ingest Integration Tests', () => {
  const mockSession = {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    },
  };

  const mockSwarm = {
    id: 'test-swarm-id',
    swarmId: 'test-swarm-id',
    name: 'test-swarm',
    workspaceId: 'test-workspace-id',
    repositoryUrl: 'https://github.com/test-owner/test-repo',
    defaultBranch: 'main',
    swarmUrl: 'https://test-swarm.sphinx.chat/api',
    swarmApiKey: JSON.stringify({
      data: 'encrypted_api_key',
      iv: 'test_iv',
      tag: 'test_tag',
      version: '1',
      encryptedAt: '2024-01-01T00:00:00Z',
    }),
  };

  const mockRepository = {
    id: 'test-repo-id',
    name: 'test-repo',
    repositoryUrl: 'https://github.com/test-owner/test-repo',
    workspaceId: 'test-workspace-id',
    status: RepositoryStatus.PENDING,
    branch: 'main',
  };

  const mockGithubCreds = {
    username: 'test-username',
    pat: 'test-pat-token',
  };

  const mockEncryptionService = {
    decryptField: vi.fn().mockReturnValue('decrypted-api-key'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    (getServerSession as any).mockResolvedValue(mockSession);
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
    (getGithubUsernameAndPAT as any).mockResolvedValue(mockGithubCreds);
    (saveOrUpdateSwarm as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without valid session', async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('should reject requests with invalid user session', async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  describe('Request Validation', () => {
    it('should reject requests without swarmId', async () => {
      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Missing required fields: swarmId');
    });

    it('should handle malformed JSON in request body', async () => {
      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');
    });
  });

  describe('Swarm Validation and Configuration', () => {
    it('should reject requests for non-existent swarm', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'non-existent-swarm' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Swarm not found');
    });

    it('should reject swarms without proper configuration', async () => {
      const incompleteSwarm = { ...mockSwarm, swarmUrl: null, swarmApiKey: null };
      (db.swarm.findFirst as any).mockResolvedValue(incompleteSwarm);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Swarm URL or API key not set');
    });

    it('should reject swarms without repository configuration', async () => {
      const swarmWithoutRepo = { ...mockSwarm, repositoryUrl: null };
      (db.swarm.findFirst as any).mockResolvedValue(swarmWithoutRepo);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe('No repository URL found');
    });
  });

  describe('Repository Operations', () => {
    it('should create new repository when none exists', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(db.repository.upsert).toHaveBeenCalledWith({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: mockSwarm.repositoryUrl,
            workspaceId: mockSwarm.workspaceId,
          },
        },
        update: { status: RepositoryStatus.PENDING },
        create: {
          name: 'test-repo',
          repositoryUrl: mockSwarm.repositoryUrl,
          workspaceId: mockSwarm.workspaceId,
          status: RepositoryStatus.PENDING,
          branch: 'main',
        },
      });
    });

    it('should update existing repository status', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (db.repository.update as any).mockResolvedValue({ ...mockRepository, status: RepositoryStatus.SYNCED });
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(db.repository.update).toHaveBeenCalledWith({
        where: { id: mockRepository.id },
        data: { status: RepositoryStatus.SYNCED },
      });
    });
  });

  describe('Third-Party Service Integration', () => {
    it('should call stakgraph API with correct parameters', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(swarmApiRequest).toHaveBeenCalledWith({
        swarmUrl: 'https://test-swarm.sphinx.chat:7799',
        endpoint: '/ingest_async',
        method: 'POST',
        apiKey: 'decrypted-api-key',
        data: {
          repo_url: mockSwarm.repositoryUrl,
          username: mockGithubCreds.username,
          pat: mockGithubCreds.pat,
          callback_url: 'https://test.com/api/swarm/stakgraph/webhook',
        },
      });
    });

    it('should handle stakgraph API failures gracefully', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: 'Internal server error' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.data).toEqual({ error: 'Internal server error' });
    });
  });

  describe('Webhook Setup Integration', () => {
    it('should set up webhook for repository', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: mockSession.user.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        callbackUrl: 'https://test.com/api/github/webhook',
      });
    });

    it('should continue processing even if webhook setup fails', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockRejectedValue(new Error('Webhook setup failed')),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Webhook setup failed');

      consoleSpy.mockRestore();
    });
  });

  describe('Data Integrity and State Management', () => {
    it('should update swarm with ingest reference ID when provided', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-ingest-ref-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: mockSwarm.workspaceId,
        ingestRefId: 'test-ingest-ref-id',
      });
    });

    it('should maintain consistent repository status across operations', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (db.repository.update as any).mockResolvedValue({ ...mockRepository, status: RepositoryStatus.SYNCED });
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.repositoryStatus).toBe(RepositoryStatus.SYNCED);
      expect(db.repository.update).toHaveBeenCalledWith({
        where: { id: mockRepository.id },
        data: { status: RepositoryStatus.SYNCED },
      });
    });

    it('should handle repository status when API call does not indicate success', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'processing', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.repositoryStatus).toBe(RepositoryStatus.PENDING);
      expect(db.repository.update).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database connection errors', async () => {
      (db.swarm.findFirst as any).mockRejectedValue(new Error('Database connection failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle GitHub credentials not available', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (getGithubUsernameAndPAT as any).mockResolvedValue(null);
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-request-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(request);

      expect(swarmApiRequest).toHaveBeenCalledWith({
        swarmUrl: 'https://test-swarm.sphinx.chat:7799',
        endpoint: '/ingest_async',
        method: 'POST',
        apiKey: 'decrypted-api-key',
        data: {
          repo_url: mockSwarm.repositoryUrl,
          username: null,
          pat: null,
          callback_url: 'https://test.com/api/swarm/stakgraph/webhook',
        },
      });
    });

    it('should handle encryption service failures', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleSpy.mockRestore();
    });
  });

  describe('Complete End-to-End Orchestration', () => {
    it('should successfully complete full ingestion workflow', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (db.repository.update as any).mockResolvedValue({ ...mockRepository, status: RepositoryStatus.SYNCED });
      (swarmApiRequest as any).mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'success', request_id: 'test-ingest-ref-id' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'webhook-secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.repositoryStatus).toBe(RepositoryStatus.SYNCED);
      expect(data.data.request_id).toBe('test-ingest-ref-id');

      // Verify all operations were called in correct order
      expect(getServerSession).toHaveBeenCalled();
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { swarmId: 'test-swarm-id' },
      });
      expect(db.repository.upsert).toHaveBeenCalled();
      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(mockSession.user.id);
      expect(swarmApiRequest).toHaveBeenCalled();
      expect(mockWebhookService.ensureRepoWebhook).toHaveBeenCalled();
      expect(db.repository.update).toHaveBeenCalled();
      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: mockSwarm.workspaceId,
        ingestRefId: 'test-ingest-ref-id',
      });
    });

    it('should handle partial failures gracefully maintaining data integrity', async () => {
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mockRepository);
      (swarmApiRequest as any).mockResolvedValue({
        ok: false,
        status: 503,
        data: { error: 'Service temporarily unavailable' },
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockRejectedValue(new Error('GitHub API rate limited')),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new NextRequest('http://localhost:3000/api/swarm/stakgraph/ingest', {
        method: 'POST',
        body: JSON.stringify({ swarmId: 'test-swarm-id' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      // Should return failure status from stakgraph API
      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.data.error).toBe('Service temporarily unavailable');

      // Repository should still be created/updated
      expect(db.repository.upsert).toHaveBeenCalled();
      
      // Webhook error should be logged but not break the flow
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: GitHub API rate limited');

      // Repository status should remain PENDING due to API failure
      expect(data.repositoryStatus).toBe(RepositoryStatus.PENDING);

      consoleSpy.mockRestore();
    });
  });
});