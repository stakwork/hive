import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '@/app/api/github/webhook/[workspaceId]/route';
import { RepositoryStatus, ArtifactType, TaskStatus, WorkflowStatus } from '@prisma/client';
import {
  createWebhookTestScenario,
  createGitHubPushPayload,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
} from '@/__tests__/support/factories/github-webhook.factory';
import { resetDatabase } from '@/__tests__/support/utilities/database';
import { db } from '@/lib/db';
import { triggerAsyncSync } from '@/services/swarm/stakgraph-actions';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { pusherServer } from '@/lib/pusher';
import { releaseTaskPod } from '@/lib/pods/utils';
import { generateUniqueId } from '@/__tests__/support/helpers';

// Mock external services
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
}));
vi.mock('@/lib/pods/utils', async () => {
  const actual = await vi.importActual('@/lib/pods/utils');
  return {
    ...actual,
    releaseTaskPod: vi.fn(),
  };
});

// Type for test setup (inline since it's not exported from fixture)
type TestRepositorySetup = Awaited<ReturnType<typeof createTestRepository>>;

describe('POST /api/github/webhook/[workspaceId]', () => {
  let testSetup: TestRepositorySetup;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Setup default successful mocks for external services
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: 'test-user',
      token: 'test-pat-token',
    });

    vi.mocked(triggerAsyncSync).mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: 'sync-req-123' },
    });

    vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication & Security', () => {
    test('should reject webhook with invalid signature', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      // Create invalid signature (using wrong secret)
      const invalidSignature = computeValidWebhookSignature(
        'wrong-secret',
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        invalidSignature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);

      // Verify no database changes occurred
      const repo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });
      expect(repo?.status).toBe(RepositoryStatus.SYNCED);
    });

    test('should reject webhook with missing signature header', async () => {
      testSetup = await createWebhookTestScenario();

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const request = new Request(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-github-event': 'push',
            'x-github-delivery': 'delivery-123',
            // Missing x-hub-signature-256
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('should reject webhook with missing event header', async () => {
      testSetup = await createWebhookTestScenario();

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = new Request(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hub-signature-256': signature,
            'x-github-delivery': 'delivery-123',
            // Missing x-github-event
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('Push Event Processing', () => {
    test('should successfully process valid push webhook to main branch', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      // Verify database status updated
      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });
      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);

      // Verify external services were called
      expect(getGithubUsernameAndPAT).toHaveBeenCalled();
      expect(triggerAsyncSync).toHaveBeenCalled();
    });

    test('should successfully process push to repository default branch', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'develop',
        status: RepositoryStatus.SYNCED,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      // Push to repository default branch (main)
      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(202);

      // Verify processing occurred
      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });
      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);
    });

    test('should skip processing push to non-tracked branch', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Push to feature branch (not tracked)
      const payload = createGitHubPushPayload(
        'refs/heads/feature/new-feature',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(true);
      
      // Verify no database changes
      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });
      expect(updatedRepo?.status).toBe(RepositoryStatus.SYNCED);

      // Verify external services were NOT called
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test('should process push to master branch (fallback branch)', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'develop',
        status: RepositoryStatus.SYNCED,
      });

      // Push to master branch (fallback allowed branch)
      const payload = createGitHubPushPayload(
        'refs/heads/master',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(202);

      // Verify processing occurred
      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });
      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);
    });
  });

  describe('Error Handling', () => {
    test('should return 404 when workspace does not exist', async () => {
      testSetup = await createWebhookTestScenario();

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const nonExistentWorkspaceId = 'non-existent-workspace-id';
      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${nonExistentWorkspaceId}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: nonExistentWorkspaceId },
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('should return 404 when repository does not exist', async () => {
      testSetup = await createWebhookTestScenario();

      // Create payload with non-existent repository URL
      const payload = createGitHubPushPayload(
        'refs/heads/main',
        'https://github.com/non-existent/repo'
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        'webhook-123'
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('should return 400 when swarm does not exist', async () => {
      // Create repository without swarm
      testSetup = await createWebhookTestScenario();

      // Delete the swarm
      await db.swarm.delete({
        where: { id: testSetup.swarm!.id },
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('should handle GitHub credentials fetch failure', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Mock credentials failure
      vi.mocked(getGithubUsernameAndPAT).mockRejectedValue(
        new Error('GitHub credentials not found')
      );

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('should handle async sync trigger failure', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Mock sync trigger failure
      vi.mocked(triggerAsyncSync).mockRejectedValue(
        new Error('Sync service unavailable')
      );

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('Database State Transitions', () => {
    test('should update repository status from SYNCED to PENDING', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });

      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);
    });

    test('should update repository status from FAILED to PENDING on retry', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.FAILED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      const updatedRepo = await db.repository.findUnique({
        where: { id: testSetup.repository.id },
      });

      expect(updatedRepo?.status).toBe(RepositoryStatus.PENDING);
    });

    test('should store ingest request ID in swarm record', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const mockRequestId = 'sync-req-456';
      vi.mocked(triggerAsyncSync).mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: mockRequestId },
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testSetup.swarm!.id },
      });

      expect(updatedSwarm?.ingestRefId).toBe(mockRequestId);
    });
  });

  describe('External Service Integration', () => {
    test('should call triggerAsyncSync with correct parameters', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(triggerAsyncSync).toHaveBeenCalledWith(
        expect.stringContaining('test-swarm'),  // swarmHost
        'sk_test_swarm_123',  // decryptedSwarmApiKey
        testSetup.repository.repositoryUrl,  // repositoryUrl
        expect.objectContaining({
          username: 'test-user',
          pat: 'test-pat-token',
        }),  // credentials
        expect.stringContaining('/api/swarm/stakgraph/webhook'),  // callbackUrl
        false,  // useLsp
        expect.objectContaining({
          docs: true,
        })  // options (SyncOptions)
      );
    });

    // NOTE: Pusher notification is not currently implemented in the webhook route
    // This test is skipped until the feature is implemented
    test.skip('should trigger Pusher notification on successful processing', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.stringContaining(`workspace-${testSetup.workspace.id}`),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Pull Request Events', () => {
    test('should acknowledge pull request events but skip processing (currently disabled)', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const prPayload = {
        action: 'closed',
        pull_request: {
          merged: true,
          number: 42,
          title: 'Test PR',
          html_url: 'https://github.com/test-org/test-repo/pull/42',
        },
        repository: {
          html_url: testSetup.repository.repositoryUrl,
          default_branch: 'main',
        },
      };

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(prPayload)
      );

      const request = new Request(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hub-signature-256': signature,
            'x-github-event': 'pull_request',
            'x-github-delivery': 'pr-delivery-123',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      // Should return 202 (acknowledged) but not process
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify no sync was triggered
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });
  });

  describe('Encryption & Decryption', () => {
    test('should successfully decrypt webhook secret for signature verification', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      // Use the actual webhook secret for signature
      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      const response = await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      // Should succeed (signature verification passed)
      expect(response.status).toBe(202);
    });

    test('should successfully decrypt swarm API key for sync trigger', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const payload = createGitHubPushPayload(
        'refs/heads/main',
        testSetup.repository.repositoryUrl
      );

      const signature = computeValidWebhookSignature(
        testSetup.webhookSecret,
        JSON.stringify(payload)
      );

      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
        payload,
        signature,
        testSetup.repository.githubWebhookId!
      );

      await POST(request, {
        params: { workspaceId: testSetup.workspace.id },
      });

      // Verify triggerAsyncSync was called (meaning API key was successfully decrypted)
      expect(triggerAsyncSync).toHaveBeenCalled();
    });
  });
});
