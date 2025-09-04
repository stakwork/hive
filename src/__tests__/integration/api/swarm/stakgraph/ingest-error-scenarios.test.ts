import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/swarm/stakgraph/ingest/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { WebhookService } from '@/services/github/WebhookService';
import { swarmApiRequest } from '@/services/swarm/api/swarm';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { getServerSession } from 'next-auth/next';
import { RepositoryStatus } from '@prisma/client';
import {
  setupFailureScenarioMocks,
  createMockRequest,
  consoleMocks,
  databaseMocks,
} from './test-utilities';

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

describe('Stakgraph Ingest Error Scenarios', () => {
  const mockEncryptionService = {
    decryptField: vi.fn().mockReturnValue('decrypted-api-key'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication Failures', () => {
    it('should handle session retrieval errors', async () => {
      (getServerSession as any).mockRejectedValue(new Error('Session service unavailable'));
      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', expect.any(Error));

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle malformed session data', async () => {
      (getServerSession as any).mockResolvedValue({ user: { id: null } });

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  describe('Database Operation Failures', () => {
    it('should handle swarm query database errors', async () => {
      const mocks = setupFailureScenarioMocks.noSwarm();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockRejectedValue(new Error('Database connection timeout'));
      
      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');
      expect(consoleSpy).toHaveBeenCalledWith('Error ingesting code:', expect.any(Error));

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle repository upsert failures', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockRejectedValue(new Error('Unique constraint violation'));
      
      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle repository status update failures', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      mocks.mockStakgraphResponse.ok = true;
      mocks.mockStakgraphResponse.data = { status: 'success', request_id: 'test-id' };

      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (db.repository.update as any).mockRejectedValue(new Error('Failed to update repository status'));
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });
      (swarmApiRequest as any).mockResolvedValue(mocks.mockStakgraphResponse);
      (saveOrUpdateSwarm as any).mockResolvedValue(undefined);

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });
  });

  describe('External Service Failures', () => {
    it('should handle GitHub credential retrieval failures', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      mocks.mockStakgraphResponse.ok = true;

      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (getGithubUsernameAndPAT as any).mockRejectedValue(new Error('GitHub API rate limited'));
      
      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle stakgraph API communication failures', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });
      (swarmApiRequest as any).mockRejectedValue(new Error('Network timeout'));

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle stakgraph API returning non-JSON response', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });
      (swarmApiRequest as any).mockResolvedValue({
        ok: false,
        status: 502,
        data: undefined, // Simulates non-JSON response
      });

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.data).toBeUndefined();
    });

    it('should handle webhook service instantiation failures', async () => {
      const mocks = setupFailureScenarioMocks.webhookFailure();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });
      (swarmApiRequest as any).mockResolvedValue(mocks.mockStakgraphResponse);
      (WebhookService as any).mockImplementation(() => {
        throw new Error('Service configuration error');
      });

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      // Should still return success from stakgraph API, with webhook error logged
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Service configuration error');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle swarm data saving failures', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      mocks.mockStakgraphResponse.ok = true;
      mocks.mockStakgraphResponse.data = { status: 'success', request_id: 'test-id' };

      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (db.repository.update as any).mockResolvedValue({ ...mocks.mockRepository, status: RepositoryStatus.SYNCED });
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });
      (swarmApiRequest as any).mockResolvedValue(mocks.mockStakgraphResponse);
      (saveOrUpdateSwarm as any).mockRejectedValue(new Error('Failed to save swarm data'));

      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: 'secret' }),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });
  });

  describe('Encryption Service Failures', () => {
    it('should handle decryption failures for swarm API key', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Invalid encryption format');
      });

      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
      (getGithubUsernameAndPAT as any).mockResolvedValue({ username: 'test', pat: 'token' });

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle encryption service initialization failures', async () => {
      (EncryptionService.getInstance as any).mockImplementation(() => {
        throw new Error('Encryption service initialization failed');
      });

      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });
  });

  describe('Resource Constraint Scenarios', () => {
    it('should handle memory pressure during processing', async () => {
      const mocks = setupFailureScenarioMocks.stakgraphApiFailure();
      mocks.mockStakgraphResponse.ok = true;

      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
      (db.repository.upsert as any).mockImplementation(() => {
        throw new Error('Out of memory');
      });

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });

    it('should handle database connection pool exhaustion', async () => {
      databaseMocks.setupDatabaseErrorMocks(db, new Error('Connection pool exhausted'));
      
      const mocks = setupFailureScenarioMocks.noSwarm();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });
  });

  describe('Data Consistency Edge Cases', () => {
    it('should handle swarm with missing repository configuration', async () => {
      const incompleteSwarm = {
        id: 'test-swarm-id',
        swarmId: 'test-swarm-id',
        workspaceId: 'test-workspace-id',
        repositoryUrl: null,
        defaultBranch: null,
        swarmUrl: 'https://test-swarm.sphinx.chat/api',
        swarmApiKey: JSON.stringify({ data: 'encrypted' }),
      };

      (getServerSession as any).mockResolvedValue(setupFailureScenarioMocks.noSwarm().mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(incompleteSwarm);

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe('No repository URL found');
    });

    it('should handle swarm with corrupted API key data', async () => {
      const corruptedSwarm = {
        id: 'test-swarm-id',
        swarmId: 'test-swarm-id',
        workspaceId: 'test-workspace-id',
        repositoryUrl: 'https://github.com/test-owner/test-repo',
        defaultBranch: 'main',
        swarmUrl: 'https://test-swarm.sphinx.chat/api',
        swarmApiKey: 'corrupted-json-data',
      };

      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error('Unable to decrypt corrupted data');
      });

      (getServerSession as any).mockResolvedValue(setupFailureScenarioMocks.noSwarm().mockSession);
      (db.swarm.findFirst as any).mockResolvedValue(corruptedSwarm);
      (db.repository.upsert as any).mockResolvedValue(setupFailureScenarioMocks.noSwarm().mockRepository);

      const consoleSpy = consoleMocks.mockConsoleError();

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Failed to ingest code');

      consoleMocks.restoreConsoleMocks([consoleSpy]);
    });
  });
});