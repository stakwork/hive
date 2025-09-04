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
import {
  setupSuccessfulIngestionMocks,
  createMockRequest,
  externalServiceMocks,
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

describe('Stakgraph Ingest Performance Tests', () => {
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

  describe('Response Time Performance', () => {
    it('should complete successful ingestion within acceptable time limits', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      const mockWebhookService = externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const startTime = performance.now();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should handle authentication quickly', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);

      const startTime = performance.now();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      // Mock other operations to fail fast to measure auth time
      (db.swarm.findFirst as any).mockRejectedValue(new Error('Stop after auth'));
      
      try {
        await POST(request as NextRequest);
      } catch {
        // Expected to fail
      }
      
      const endTime = performance.now();
      const authTime = endTime - startTime;

      expect(authTime).toBeLessThan(1000); // Auth should be very fast
      expect(getServerSession).toHaveBeenCalled();
    });

    it('should handle database operations efficiently', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      
      let dbOperationTime = 0;
      
      (db.swarm.findFirst as any).mockImplementation(async (...args) => {
        const start = performance.now();
        const result = mocks.mockSwarm;
        const end = performance.now();
        dbOperationTime += (end - start);
        return result;
      });
      
      (db.repository.upsert as any).mockImplementation(async (...args) => {
        const start = performance.now();
        const result = mocks.mockRepository;
        const end = performance.now();
        dbOperationTime += (end - start);
        return result;
      });
      
      (db.repository.update as any).mockImplementation(async (...args) => {
        const start = performance.now();
        const result = { ...mocks.mockRepository, status: 'SYNCED' };
        const end = performance.now();
        dbOperationTime += (end - start);
        return result;
      });

      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      await POST(request as NextRequest);

      expect(dbOperationTime).toBeLessThan(2000); // DB operations should complete quickly
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple concurrent requests efficiently', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const concurrentRequests = 5;
      const requests = Array(concurrentRequests).fill(null).map((_, index) => 
        createMockRequest({ swarmId: `test-swarm-id-${index}` })
      );

      const startTime = performance.now();
      
      const responses = await Promise.all(
        requests.map(request => POST(request as NextRequest))
      );
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should complete successfully
      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
      }

      // Concurrent execution should be faster than sequential
      expect(totalTime).toBeLessThan(concurrentRequests * 2000);
    });

    it('should handle mixed success and failure scenarios concurrently', async () => {
      const successMocks = setupSuccessfulIngestionMocks();
      
      // Setup alternating success/failure responses
      let callCount = 0;
      (getServerSession as any).mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return Promise.resolve(null); // Simulate auth failure
        }
        return Promise.resolve(successMocks.mockSession);
      });

      databaseMocks.setupSuccessfulDatabaseMocks(db, successMocks);
      externalServiceMocks.setupSuccessfulExternalMocks(successMocks, {
        getServerSession: getServerSession, // Already mocked above
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const concurrentRequests = 4;
      const requests = Array(concurrentRequests).fill(null).map((_, index) => 
        createMockRequest({ swarmId: `test-swarm-id-${index}` })
      );

      const responses = await Promise.all(
        requests.map(request => POST(request as NextRequest))
      );

      // Should have mix of success (200) and auth failure (401) responses
      const successCount = responses.filter(r => r.status === 200).length;
      const failureCount = responses.filter(r => r.status === 401).length;
      
      expect(successCount).toBe(2);
      expect(failureCount).toBe(2);
    });
  });

  describe('Resource Usage Optimization', () => {
    it('should minimize memory allocation during processing', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      // Simulate memory pressure by monitoring garbage collection
      const initialMemory = process.memoryUsage();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      expect(response.status).toBe(200);
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    });

    it('should release resources properly on error', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      (db.swarm.findFirst as any).mockRejectedValue(new Error('Simulated database error'));

      const initialMemory = process.memoryUsage();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      expect(response.status).toBe(500);
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Minimal memory increase on error
    });
  });

  describe('External Service Timeout Handling', () => {
    it('should handle stakgraph API timeouts gracefully', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      (getGithubUsernameAndPAT as any).mockResolvedValue(mocks.mockGithubCreds);
      
      // Simulate slow stakgraph API
      (swarmApiRequest as any).mockImplementation(() => 
        new Promise(resolve => {
          setTimeout(() => {
            resolve({
              ok: false,
              status: 408,
              data: { error: 'Request timeout' }
            });
          }, 2000); // 2 second delay
        })
      );

      const startTime = performance.now();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(408);
      expect(responseTime).toBeGreaterThan(1900); // Should wait for the timeout
      expect(responseTime).toBeLessThan(3000); // But not hang indefinitely
    });

    it('should handle webhook service timeouts without affecting main flow', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      (getServerSession as any).mockResolvedValue(mocks.mockSession);
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      (getGithubUsernameAndPAT as any).mockResolvedValue(mocks.mockGithubCreds);
      (swarmApiRequest as any).mockResolvedValue(mocks.mockStakgraphResponse);
      (saveOrUpdateSwarm as any).mockResolvedValue(undefined);
      
      // Simulate slow webhook service
      const mockWebhookService = {
        ensureRepoWebhook: vi.fn().mockImplementation(() =>
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Webhook timeout'));
            }, 1500);
          })
        ),
      };
      (WebhookService as any).mockImplementation(() => mockWebhookService);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const startTime = performance.now();
      
      const request = createMockRequest({ swarmId: 'test-swarm-id' });
      const response = await POST(request as NextRequest);
      
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200); // Should still succeed
      expect(responseTime).toBeGreaterThan(1400); // Should wait for webhook timeout
      expect(responseTime).toBeLessThan(3000); // But complete reasonably quickly
      expect(consoleSpy).toHaveBeenCalledWith('Error ensuring repo webhook: Error: Webhook timeout');

      consoleSpy.mockRestore();
    });
  });

  describe('Load Testing Scenarios', () => {
    it('should maintain performance under sustained load', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const batchSize = 3;
      const numberOfBatches = 3;
      const results: number[] = [];

      for (let batch = 0; batch < numberOfBatches; batch++) {
        const requests = Array(batchSize).fill(null).map((_, index) => 
          createMockRequest({ swarmId: `load-test-${batch}-${index}` })
        );

        const batchStartTime = performance.now();
        
        const responses = await Promise.all(
          requests.map(request => POST(request as NextRequest))
        );
        
        const batchEndTime = performance.now();
        const batchTime = batchEndTime - batchStartTime;
        results.push(batchTime);

        // All requests should succeed
        for (const response of responses) {
          expect(response.status).toBe(200);
        }

        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Performance should not degrade significantly over time
      const firstBatchTime = results[0];
      const lastBatchTime = results[results.length - 1];
      const degradation = (lastBatchTime - firstBatchTime) / firstBatchTime;
      
      expect(degradation).toBeLessThan(0.5); // Less than 50% performance degradation
    });

    it('should handle rapid successive requests from same user', async () => {
      const mocks = setupSuccessfulIngestionMocks();
      databaseMocks.setupSuccessfulDatabaseMocks(db, mocks);
      externalServiceMocks.setupSuccessfulExternalMocks(mocks, {
        getServerSession,
        getGithubUsernameAndPAT,
        swarmApiRequest,
        WebhookService,
        saveOrUpdateSwarm,
      });

      const rapidRequests = 5;
      const requests = Array(rapidRequests).fill(null).map((_, index) => 
        createMockRequest({ swarmId: 'rapid-test', workspaceId: 'same-workspace' })
      );

      const startTime = performance.now();
      
      // Fire all requests simultaneously (no await)
      const responsePromises = requests.map(request => POST(request as NextRequest));
      const responses = await Promise.all(responsePromises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should complete
      expect(responses).toHaveLength(rapidRequests);
      
      // At least some should succeed (may have race conditions in real scenarios)
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(0);

      // Should complete within reasonable time
      expect(totalTime).toBeLessThan(10000);
    });
  });
});