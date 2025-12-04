import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock NextAuth before any imports that use it
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { POST } from '@/app/api/user-journeys/[taskId]/execute/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { POD_PORTS } from '@/lib/pods/constants';
import type { MockInstance } from 'vitest';
import { getServerSession } from 'next-auth';
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
  createTestUserJourneyTask,
  createTestTask,
} from '@/__tests__/support/fixtures';

/**
 * Integration tests for POST /api/user-journeys/[taskId]/execute
 * 
 * Tests the complete orchestration flow:
 * 1. Authentication & Authorization
 * 2. Pod Infrastructure Provisioning (Pool Manager)
 * 3. One-Time API Key Generation & Encryption
 * 4. Test Execution Trigger (Control Port)
 * 5. Database State Management
 */

// Test data factory using existing helpers
async function createExecuteTestSetup() {
  // Create user with workspace using existing helper
  const { owner: user, workspace } = await createTestWorkspaceScenario({
    workspace: {
      name: 'Test Workspace',
      slug: 'test-workspace',
      description: 'Workspace for execute endpoint tests',
    },
  });

  // Create swarm with encrypted pool API key
  const swarm = await createTestSwarm({
    workspaceId: workspace.id,
    poolName: 'test-pool',
    poolApiKey: 'mock_pool_api_key',
  });

  // Create repository using existing helper
  const repository = await createTestRepository({
    name: 'test-repo',
    repositoryUrl: 'https://github.com/testuser/test-repo',
    workspaceId: workspace.id,
  });

  // Create user journey task using existing helper
  const task = await createTestUserJourneyTask({
    title: 'Test User Journey',
    description: 'E2E test for login flow',
    workspaceId: workspace.id,
    createdById: user.id,
    status: 'TODO',
    workflowStatus: 'PENDING',
    testFilePath: 'e2e/tests/login.spec.ts',
    testFileUrl: 'https://github.com/testuser/test-repo/blob/main/e2e/tests/login.spec.ts',
  });

  return {
    user,
    workspace,
    swarm,
    repository,
    task,
  };
}

// Mock fetch for external API calls
let mockFetch: MockInstance;

// Mock successful pod claiming flow
function setupSuccessfulPodClaimMocks(
  controlUrl: string = 'https://control.test-pod.example.com',
  frontendUrl: string = 'https://frontend.test-pod.example.com',
  frontendPort: string = '3000'
) {
  const podPassword = 'mock-pod-password';
  const workspaceData = {
    workspace: {
      id: 'workspace-123',
      portMappings: {
        [POD_PORTS.CONTROL]: controlUrl,
        [frontendPort]: frontendUrl,
      },
      password: podPassword,
    },
  };
  const markUsedData = { success: true };
  const processListData = [
    { name: 'frontend', port: parseInt(frontendPort) },
    { name: 'backend', port: 8080 },
  ];
  const testExecutionData = { success: true, message: 'Test execution started' };

  mockFetch
    // GET workspace from pool
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => workspaceData,
      text: async () => JSON.stringify(workspaceData),
    })
    // POST mark workspace as used
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => markUsedData,
      text: async () => JSON.stringify(markUsedData),
    })
    // GET process list from control port
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => processListData,
      text: async () => JSON.stringify(processListData),
    })
    // POST trigger test execution
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => testExecutionData,
      text: async () => JSON.stringify(testExecutionData),
    });
}

// Mock pod claiming failure
function setupPodClaimFailureMock(errorMessage: string = 'No available workspaces') {
  const errorData = { error: errorMessage };
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => errorData,
    text: async () => JSON.stringify(errorData),
  });
}

// Mock control port failure
function setupControlPortFailureMock(
  controlUrl: string = 'https://control.test-pod.example.com',
  frontendUrl: string = 'https://frontend.test-pod.example.com',
  frontendPort: string = '3000'
) {
  const podPassword = 'mock-pod-password';
  const workspaceData = {
    workspace: {
      id: 'workspace-123',
      portMappings: {
        [POD_PORTS.CONTROL]: controlUrl,
        [frontendPort]: frontendUrl,
      },
      password: podPassword,
    },
  };
  const markUsedData = { success: true };
  const processListData = [
    { name: 'frontend', port: parseInt(frontendPort) },
  ];
  const errorData = { error: 'Test execution failed' };

  mockFetch
    // GET workspace from pool
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => workspaceData,
      text: async () => JSON.stringify(workspaceData),
    })
    // POST mark workspace as used
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => markUsedData,
      text: async () => JSON.stringify(markUsedData),
    })
    // GET process list from control port
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => processListData,
      text: async () => JSON.stringify(processListData),
    })
    // POST trigger test execution - FAILS
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => errorData,
      text: async () => JSON.stringify(errorData),
    });
}

describe('POST /api/user-journeys/[taskId]/execute', () => {
  let testSetup: Awaited<ReturnType<typeof createExecuteTestSetup>>;
  let encryptionService: EncryptionService;

  beforeEach(async () => {
    // Setup test data
    testSetup = await createExecuteTestSetup();
    encryptionService = EncryptionService.getInstance();

    // Setup fetch mock
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Mock NextAuth session for authenticated user
    vi.mocked(getServerSession).mockResolvedValue({
      user: { 
        id: testSetup.user.id, 
        email: testSetup.user.email,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  describe('Success Flow', () => {
    it('should orchestrate complete execution flow', async () => {
      // Setup successful pod claiming mocks
      setupSuccessfulPodClaimMocks();

      // Execute endpoint
      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      // Assert response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        taskId: testSetup.task.id,
        testFilePath: 'e2e/tests/login.spec.ts',
        podStatus: 'claimed',
        testStatus: 'running',
      });
      expect(data.data.frontendUrl).toContain('frontend.test-pod.example.com');

      // Assert one-time API key was generated and encrypted
      const updatedTask = await db.task.findUnique({
        where: { id: testSetup.task.id },
      });
      expect(updatedTask?.agentPassword).toBeDefined();
      
      // Decrypt and validate API key format
      const decryptedKey = encryptionService.decryptField('agentPassword', updatedTask!.agentPassword!);
      expect(decryptedKey).toMatch(/^[a-f0-9]{64}$/); // 32 bytes = 64 hex chars

      // Assert task status updated
      expect(updatedTask?.workflowStatus).toBe('IN_PROGRESS');
    });

    it('should bypass pod claiming in local development mode', async () => {
      // Set local development environment variable
      const originalCustomUrl = process.env.CUSTOM_STAKLINK_URL;
      process.env.CUSTOM_STAKLINK_URL = 'http://localhost:3355';

      // Mock the test execution call for local mode
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      try {
        // Execute endpoint
        const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
        const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

        // Assert response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.podStatus).toBe('local');
        expect(data.data.frontendUrl).toBeNull();

        // Assert no pod claiming calls (only test execution)
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/playwright_test'),
          expect.any(Object)
        );
      } finally {
        // Restore environment variable
        if (originalCustomUrl) {
          process.env.CUSTOM_STAKLINK_URL = originalCustomUrl;
        } else {
          delete process.env.CUSTOM_STAKLINK_URL;
        }
      }
    });
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 for unauthenticated requests', async () => {
      // Mock unauthenticated session
      vi.mocked(getServerSession).mockResolvedValue(null);

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 403 for non-workspace members', async () => {
      // Create another user without workspace membership
      const otherUser = await db.user.create({
        data: {
          name: 'Other User',
          email: 'other@example.com',
          emailVerified: new Date(),
        },
      });

      // Mock session for other user
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: otherUser.id, 
          email: otherUser.email,
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Task Validation', () => {
    it('should return 404 for non-existent task', async () => {
      const nonExistentTaskId = 'non-existent-task-id';
      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: nonExistentTaskId }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return 404 for non-user-journey tasks', async () => {
      // Create regular task (not user journey)  using helper
      const regularTask = await createTestTask({
        title: 'Regular Task',
        description: 'Not a user journey',
        workspaceId: testSetup.workspace.id,
        createdById: testSetup.user.id,
        sourceType: 'SYSTEM',
        status: 'TODO',
      });

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: regularTask.id }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });
  });

  describe('Error Handling', () => {
    it('should handle pod claiming failures', async () => {
      setupPodClaimFailureMock('No available workspaces in pool');

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toContain('claim');
    });

    it('should handle control port failures', async () => {
      setupControlPortFailureMock();

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('execution');
    });

    it('should handle missing swarm configuration', async () => {
      // Delete swarm
      await db.swarm.delete({ where: { id: testSetup.swarm.id } });

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('swarm');
    });

    it('should handle missing test file path', async () => {
      // Update task to remove test file path
      await db.task.update({
        where: { id: testSetup.task.id },
        data: { testFilePath: null },
      });

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('test file path');
    });

    it('should handle missing repository', async () => {
      // Delete repository
      await db.repository.delete({ where: { id: testSetup.repository.id } });

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      const response = await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('repository');
    });
  });

  describe('Security', () => {
    it('should generate unique one-time API keys for each execution', async () => {
      // Execute endpoint twice
      setupSuccessfulPodClaimMocks();
      const mockRequest1 = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest1, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      const task1 = await db.task.findUnique({ where: { id: testSetup.task.id } });
      const apiKey1 = encryptionService.decryptField('agentPassword', task1!.agentPassword!);

      setupSuccessfulPodClaimMocks();
      const mockRequest2 = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest2, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      const task2 = await db.task.findUnique({ where: { id: testSetup.task.id } });
      const apiKey2 = encryptionService.decryptField('agentPassword', task2!.agentPassword!);

      // API keys should be different
      expect(apiKey1).not.toBe(apiKey2);
    });

    it('should encrypt API keys with proper structure', async () => {
      setupSuccessfulPodClaimMocks();

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      const task = await db.task.findUnique({ where: { id: testSetup.task.id } });
      const encryptedData = JSON.parse(task!.agentPassword!);

      // Validate encrypted data structure
      expect(encryptedData).toHaveProperty('data');
      expect(encryptedData).toHaveProperty('iv');
      expect(encryptedData).toHaveProperty('tag');
      expect(encryptedData).toHaveProperty('version');
      expect(encryptedData).toHaveProperty('encryptedAt');
    });
  });

  describe('Database Updates', () => {
    it('should update task workflowStatus to IN_PROGRESS', async () => {
      setupSuccessfulPodClaimMocks();

      // Verify initial status
      const initialTask = await db.task.findUnique({ where: { id: testSetup.task.id } });
      expect(initialTask?.workflowStatus).toBe('PENDING');

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      // Verify updated status
      const updatedTask = await db.task.findUnique({ where: { id: testSetup.task.id } });
      expect(updatedTask?.workflowStatus).toBe('IN_PROGRESS');
    });

    it('should not modify task status field (user-controlled)', async () => {
      setupSuccessfulPodClaimMocks();

      // Verify initial status
      const initialTask = await db.task.findUnique({ where: { id: testSetup.task.id } });
      expect(initialTask?.status).toBe('TODO');

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      // Verify status unchanged (only workflowStatus changes)
      const updatedTask = await db.task.findUnique({ where: { id: testSetup.task.id } });
      expect(updatedTask?.status).toBe('TODO');
    });
  });

  describe('Webhook URL Construction', () => {
    it('should construct callback URL with task ID', async () => {
      setupSuccessfulPodClaimMocks();

      const mockRequest = new Request('http://localhost:3000', { method: 'POST' });
      await POST(mockRequest, { params: Promise.resolve({ taskId: testSetup.task.id }) });

      // Assert webhook URL was passed to control port
      const testTriggerCall = mockFetch.mock.calls.find(
        (call) => call[0]?.includes('/playwright_test')
      );
      
      expect(testTriggerCall).toBeDefined();
      const requestBody = JSON.parse(testTriggerCall![1].body as string);
      expect(requestBody.responseUrl).toContain(`/api/tasks/${testSetup.task.id}/recording`);
    });
  });
});
