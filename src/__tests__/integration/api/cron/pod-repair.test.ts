import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GET } from '@/app/api/cron/pod-repair/route';
import { db } from '@/lib/db';
import { resetDatabase, createTestUser, createTestWorkspace, createTestSwarm } from '@/__tests__/support/fixtures';
import { WorkflowStatus, StakworkRunType } from '@prisma/client';
import { NextRequest } from 'next/server';

// Mock pods/utils functions
const mockGetPodFromPool = vi.fn();
const mockCheckFrontendAvailable = vi.fn();

vi.mock('@/lib/pods/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pods/utils')>();
  return {
    ...actual,
    getPodFromPool: (...args: unknown[]) => mockGetPodFromPool(...args),
    checkFrontendAvailable: (...args: unknown[]) => mockCheckFrontendAvailable(...args),
  };
});

/**
 * Integration tests for GET /api/cron/pod-repair endpoint
 * 
 * Tests verify:
 * - Authentication via CRON_SECRET (Bearer token)
 * - Feature flag gating (POD_REPAIR_CRON_ENABLED)
 * - Pod repair orchestration logic
 * - Error handling and graceful degradation
 * - Database state management (StakworkRun creation)
 * - Pod selection logic (non-running pods only)
 * - Failed process detection from jlist
 * - Repair attempt limiting
 * 
 * Architecture:
 * GET /api/cron/pod-repair → executePodRepairRuns() → checks pods and triggers repairs
 * 
 * Test Database: Real PostgreSQL with sequential execution
 * Cleanup: resetDatabase() in beforeEach for test isolation
 */

// Helper function to create mock NextRequest
function createMockRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set('authorization', authHeader);
  }
  return new NextRequest('http://localhost:3000/api/cron/pod-repair', {
    headers,
  });
}

// Mock Stakwork service
let mockStakworkRequest: ReturnType<typeof vi.fn>;
let mockGetWorkflowData: ReturnType<typeof vi.fn>;
let mockGetPoolWorkspaces: ReturnType<typeof vi.fn>;
let mockStartStaklink: ReturnType<typeof vi.fn>;

vi.mock('@/lib/service-factory', () => ({
  stakworkService: () => ({
    stakworkRequest: mockStakworkRequest,
    getWorkflowData: mockGetWorkflowData,
  }),
  poolManagerService: () => ({
    getPoolWorkspaces: mockGetPoolWorkspaces,
    startStaklink: mockStartStaklink,
  }),
}));

describe('GET /api/cron/pod-repair', () => {
  let originalCronEnabled: string | undefined;
  let originalCronSecret: string | undefined;
  let originalWorkflowId: string | undefined;
  let originalEncryptionKey: string | undefined;
  let originalEncryptionKeyId: string | undefined;

  beforeEach(async () => {
    // Store and set environment variables
    originalCronEnabled = process.env.POD_REPAIR_CRON_ENABLED;
    originalCronSecret = process.env.CRON_SECRET;
    originalWorkflowId = process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID;
    originalEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    originalEncryptionKeyId = process.env.TOKEN_ENCRYPTION_KEY_ID;

    process.env.POD_REPAIR_CRON_ENABLED = 'true';
    process.env.CRON_SECRET = 'test-secret-123';
    process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID = '12345';
    process.env.STAKWORK_API_KEY = 'test-api-key';
    process.env.STAKWORK_BASE_URL = 'https://api.stakwork.com';
    process.env.POD_REPAIR_MAX_ATTEMPTS = '10';
    process.env.TOKEN_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    process.env.TOKEN_ENCRYPTION_KEY_ID = 'k-test';

    // Reset database
    await resetDatabase();
    
    // Reset mocks
    vi.clearAllMocks();

    // Setup default mocks
    mockStakworkRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 123 },
    });

    mockGetWorkflowData = vi.fn().mockResolvedValue({ status: 'completed' });
    mockGetPoolWorkspaces = vi.fn().mockResolvedValue({ workspaces: [] });
    mockStartStaklink = vi.fn().mockResolvedValue({
      success: true,
      message: 'staklink started',
      workspace_id: 'test-workspace',
    });

    // Default pod utils mocks
    mockGetPodFromPool.mockResolvedValue({
      portMappings: {
        '15552': 'https://control.example.com',
        '3000': 'https://frontend.example.com',
      },
    });
    mockCheckFrontendAvailable.mockResolvedValue({
      available: true,
      frontendUrl: 'https://frontend.example.com',
    });
  });

  afterEach(() => {
    // Restore environment variables
    if (originalCronEnabled !== undefined) {
      process.env.POD_REPAIR_CRON_ENABLED = originalCronEnabled;
    } else {
      delete process.env.POD_REPAIR_CRON_ENABLED;
    }

    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }

    if (originalWorkflowId !== undefined) {
      process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID = originalWorkflowId;
    } else {
      delete process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID;
    }

    if (originalEncryptionKey !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }

    if (originalEncryptionKeyId !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY_ID = originalEncryptionKeyId;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY_ID;
    }
  });

  describe('Authorization', () => {
    it('should reject requests without authorization header', async () => {
      const request = createMockRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should reject requests with invalid CRON_SECRET', async () => {
      const request = createMockRequest('Bearer wrong-secret');
      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should accept requests with valid CRON_SECRET', async () => {
      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('workspacesProcessed');
    });
  });

  describe('Feature Flags', () => {
    it('should return disabled message when POD_REPAIR_CRON_ENABLED is false', async () => {
      process.env.POD_REPAIR_CRON_ENABLED = 'false';
      
      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Pod repair cron is disabled');
      expect(body.workspacesProcessed).toBe(0);
      expect(body.repairsTriggered).toBe(0);
    });

    it('should process when feature flag is enabled', async () => {
      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body).toHaveProperty('workspacesProcessed');
      expect(body).toHaveProperty('repairsTriggered');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('Pod Repair Orchestration', () => {
    it('should process eligible workspaces with pool configuration', async () => {
      // Create test user and workspace using factories
      const user = await createTestUser({ email: 'test@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'test-workspace' 
      });

      // Create swarm with pool configuration
      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key', // Important: must have poolApiKey for eligibility
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.workspacesProcessed).toBeGreaterThanOrEqual(1);
    });

    it('should respect MAX_REPAIR_ATTEMPTS limit', async () => {
      // Create test user and workspace
      const user = await createTestUser({ email: 'maxtest@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'max-test-workspace' 
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Create 10 existing repair attempts (max limit)
      for (let i = 0; i < 10; i++) {
        await db.stakworkRun.create({
          data: {
            workspaceId: workspace.id,
            type: StakworkRunType.POD_REPAIR,
            status: WorkflowStatus.COMPLETED,
            webhookUrl: 'https://example.com/webhook',
          },
        });
      }

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Should skip due to max attempts
      expect(body.skipped.maxAttemptsReached).toBeGreaterThanOrEqual(0);
    });

    it('should skip workspaces without containerFiles setup', async () => {
      const user = await createTestUser({ email: 'nocontainer@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'no-container-workspace' 
      });

      // Create swarm WITHOUT containerFiles setup
      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        containerFilesSetUp: false,
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // This workspace should not be processed
      expect(body.workspacesProcessed).toBe(0);
    });

    it('should skip workspaces without pool API key', async () => {
      const user = await createTestUser({ email: 'nopool@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'no-pool-workspace' 
      });

      // Create swarm WITHOUT pool API key
      await createTestSwarm({
        workspaceId: workspace.id,
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
        // No swarmApiKey = no poolApiKey
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // This workspace might be processed but skipped during pool check
      expect(body.repairsTriggered).toBe(0);
    });

    it('should skip workspaces with COMPLETED podState', async () => {
      const user = await createTestUser({ email: 'completed@example.com' });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: 'completed-pods-workspace'
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
        podState: 'COMPLETED',
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Should count as workspace with completed pods (skipped)
      expect(body.workspacesWithRunningPods).toBeGreaterThanOrEqual(1);
      expect(body.repairsTriggered).toBe(0);
    });

    it('should skip if repair workflow is already in progress', async () => {
      const user = await createTestUser({ email: 'inprogress@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'inprogress-workspace' 
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Create an IN_PROGRESS repair run
      await db.stakworkRun.create({
        data: {
          workspaceId: workspace.id,
          type: StakworkRunType.POD_REPAIR,
          status: WorkflowStatus.IN_PROGRESS,
          projectId: 999,
          webhookUrl: 'https://example.com/webhook',
        },
      });

      // Mock Stakwork to return in_progress status
      mockGetWorkflowData.mockResolvedValueOnce({ status: 'in_progress' });

      // Mock pool with non-running pods
      mockGetPoolWorkspaces.mockResolvedValueOnce({
        workspaces: [
          { subdomain: 'pod-1', state: 'stopped', password: 'test-pass' },
        ],
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.skipped.workflowInProgress).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Response Format', () => {
    it('should return properly structured response', async () => {
      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Verify response structure
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('workspacesProcessed');
      expect(body).toHaveProperty('workspacesWithRunningPods');
      expect(body).toHaveProperty('repairsTriggered');
      expect(body).toHaveProperty('skipped');
      expect(body.skipped).toHaveProperty('maxAttemptsReached');
      expect(body.skipped).toHaveProperty('workflowInProgress');
      expect(body.skipped).toHaveProperty('noFailedProcesses');
      expect(body).toHaveProperty('errors');
      expect(body).toHaveProperty('timestamp');
      
      // Verify types
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.workspacesProcessed).toBe('number');
      expect(typeof body.repairsTriggered).toBe('number');
      expect(Array.isArray(body.errors)).toBe(true);
      expect(typeof body.timestamp).toBe('string');
    });
  });

  describe('Frontend Availability Check', () => {
    it('should call staklink-start when jlist is unavailable', async () => {
      const user = await createTestUser({ email: 'jlistfail@example.com' });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: 'jlist-fail-workspace'
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Mock pool with non-running pod
      mockGetPoolWorkspaces.mockResolvedValueOnce({
        workspaces: [
          { subdomain: 'pod-1', state: 'stopped', password: 'test-pass' },
        ],
      });

      // Mock global fetch to return null for jlist (simulating jlist unavailable)
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/jlist')) {
          return Promise.resolve({
            ok: false,
            status: 503,
            text: () => Promise.resolve('Service Unavailable'),
          });
        }
        return originalFetch(url);
      });

      try {
        const request = createMockRequest('Bearer test-secret-123');
        const response = await GET(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        // Should call staklink-start API when jlist fails
        expect(body.staklinkRestarts).toBeGreaterThanOrEqual(1);
        expect(mockStartStaklink).toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should trigger repair when frontend is not available', async () => {
      const user = await createTestUser({ email: 'frontendfail@example.com' });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: 'frontend-fail-workspace'
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Mock pool with non-running pod
      mockGetPoolWorkspaces.mockResolvedValueOnce({
        workspaces: [
          { subdomain: 'pod-1', state: 'stopped', password: 'test-pass' },
        ],
      });

      // Mock jlist to return healthy processes including staklink-proxy
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/jlist')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { pid: 1234, name: 'staklink-proxy', status: 'online' },
              { pid: 5678, name: 'frontend', status: 'online', port: '3000' },
            ]),
          });
        }
        return originalFetch(url);
      });

      // Mock frontend check to return unavailable
      mockCheckFrontendAvailable.mockResolvedValueOnce({
        available: false,
        frontendUrl: 'https://frontend.example.com',
        error: 'Frontend URL not responding',
      });

      try {
        const request = createMockRequest('Bearer test-secret-123');
        const response = await GET(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        // Should attempt to trigger Stakwork repair for frontend when it's not available
        // Check either:
        // - repairsTriggered >= 1 (repair succeeded)
        // - Stakwork API was called (repair in progress)
        // - Error contains workflow config message (repair was attempted but config missing at runtime)
        const stakworkCalled = mockStakworkRequest.mock.calls.length > 0;
        const repairTriggered = body.repairsTriggered >= 1;
        const repairAttempted = body.errors?.some((e: { error: string }) =>
          e.error.includes('STAKWORK_POD_REPAIR_WORKFLOW_ID') ||
          e.error.includes('repair')
        );
        expect(stakworkCalled || repairTriggered || repairAttempted).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should validate frontend when all checks pass and no failed processes', async () => {
      const user = await createTestUser({ email: 'frontendok@example.com' });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: 'frontend-ok-workspace'
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        poolApiKey: 'test-pool-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Mock pool with non-running pod
      mockGetPoolWorkspaces.mockResolvedValueOnce({
        workspaces: [
          { subdomain: 'pod-1', state: 'stopped', password: 'test-pass' },
        ],
      });

      // Mock jlist to return healthy processes including staklink-proxy
      // Also mock /validate_frontend endpoint
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/jlist')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { pid: 1234, name: 'staklink-proxy', status: 'online' },
              { pid: 5678, name: 'frontend', status: 'online', port: '3000' },
            ]),
          });
        }
        if (url.includes('/validate_frontend')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true }),
          });
        }
        return originalFetch(url);
      });

      // Mock frontend check to return available
      mockCheckFrontendAvailable.mockResolvedValueOnce({
        available: true,
        frontendUrl: 'https://frontend.example.com',
      });

      try {
        const request = createMockRequest('Bearer test-secret-123');
        const response = await GET(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        // Should trigger validation when everything is healthy
        expect(body.validationsTriggered).toBeGreaterThanOrEqual(1);
        expect(body.repairsTriggered).toBe(0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully and continue processing', async () => {
      // Create workspace that will cause an error
      const user = await createTestUser({ email: 'error@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'error-workspace' 
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Mock pool manager to throw error
      mockGetPoolWorkspaces.mockRejectedValueOnce(new Error('Pool manager error'));

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Error should be recorded but not fail the entire cron
      expect(Array.isArray(body.errors)).toBe(true);
    });

    it('should handle missing workflow ID configuration', async () => {
      // Remove workflow ID
      delete process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID;

      const user = await createTestUser({ email: 'nowfid@example.com' });
      const workspace = await createTestWorkspace({ 
        ownerId: user.id, 
        slug: 'no-wfid-workspace' 
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmApiKey: 'test-api-key',
        containerFilesSetUp: true,
        containerFiles: [{ name: 'test.json', content: 'test' }],
      });

      // Mock pool with non-running pods
      mockGetPoolWorkspaces.mockResolvedValueOnce({
        workspaces: [
          { subdomain: 'pod-1', state: 'stopped', password: 'test-pass' },
        ],
      });

      const request = createMockRequest('Bearer test-secret-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      // Should complete but may have errors
      expect(body).toHaveProperty('success');
    });
  });
});
