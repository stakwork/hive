import { describe, test, expect, beforeEach, vi } from 'vitest';
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
import { dispatchIncrementalProtectReview } from '@/services/protect';
import { listProtectFindings } from '@/lib/protect/findings';
import { canonicalRepoKey } from '@/lib/utils/error-fingerprint';

const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 99 } });

function mockDispatchNoop() {
  vi.mocked(dispatchIncrementalProtectReview).mockResolvedValue({
    dispatched: false,
    reason: 'mocked',
  });
}

function mockFindingsEmpty() {
  vi.mocked(listProtectFindings).mockImplementation(async () => ({
    ok: true,
    findings: [],
  }));
}

// Mock external services
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/service-factory', () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: mockStakworkRequest,
  })),
}));
vi.mock('@/lib/protect/findings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/protect/findings')>(
    '@/lib/protect/findings',
  );
  return {
    ...actual,
    listProtectFindings: vi.fn(async () => ({ ok: true, findings: [] })),
  };
});
vi.mock('@/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/env')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      STAKWORK_API_KEY: 'test-stakwork',
      STAKWORK_PROTECT_WORKFLOW_ID: '555',
    },
    optionalEnvVars: {
      ...actual.optionalEnvVars,
      STAKWORK_PROTECT_WORKFLOW_ID: '555',
    },
  };
});
vi.mock('@/services/protect', async () => {
  const actual = await vi.importActual<typeof import('@/services/protect')>(
    '@/services/protect',
  );
  return {
    ...actual,
    dispatchIncrementalProtectReview: vi.fn().mockResolvedValue({
      dispatched: false,
      reason: 'mocked',
    }),
  };
});
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

    // Re-apply after clearAllMocks. Do not restoreAllMocks in afterEach:
    // that strips factory implementations so dispatchIncrementalProtectReview()
    // returns undefined and `undefined.catch` 500s the push handler.
    mockDispatchNoop();
    mockFindingsEmpty();
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
          embeddings: true,
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

  describe('Incremental Protect review', () => {
    beforeEach(async () => {
      mockStakworkRequest.mockClear();
      mockStakworkRequest.mockResolvedValue({ data: { project_id: 99 } });
      process.env.STAKWORK_PROTECT_WORKFLOW_ID = '555';
      process.env.STAKWORK_API_KEY = 'test-stakwork';
      const actual = await vi.importActual<typeof import('@/services/protect')>(
        '@/services/protect',
      );
      vi.mocked(dispatchIncrementalProtectReview).mockImplementation(
        actual.dispatchIncrementalProtectReview,
      );
      mockFindingsEmpty();
    });

    async function enableProtect(workspaceId: string) {
      await db.janitorConfig.create({
        data: { workspaceId, securityReviewEnabled: true },
      });
    }

    async function addToScope(workspaceId: string, repositoryId: string) {
      await db.protectReviewRepo.create({
        data: { workspaceId, repositoryId },
      });
    }

    async function completeFullReview(
      workspaceId: string,
      repository?: { id: string; repositoryUrl: string },
    ) {
      const run = await db.protectReviewRun.create({
        data: {
          workspaceId,
          mode: 'full',
          status: 'completed',
          completedAt: new Date(),
        },
      });
      if (repository) {
        await db.protectReviewRunRepo.create({
          data: {
            runId: run.id,
            repositoryId: repository.id,
            canonicalUrl: canonicalRepoKey(repository.repositoryUrl),
          },
        });
      }
      return run;
    }

    async function sendPush(
      setup: TestRepositorySetup,
      extras?: { before?: string; after?: string; waitForDispatch?: boolean },
    ) {
      const payload = createGitHubPushPayload(
        'refs/heads/main',
        setup.repository.repositoryUrl,
        'test-owner/test-repo',
        extras?.before ?? '1111111111111111111111111111111111111111',
        extras?.after ?? '2222222222222222222222222222222222222222',
      );
      const signature = computeValidWebhookSignature(
        setup.webhookSecret,
        JSON.stringify(payload),
      );
      const request = createWebhookRequest(
        `http://localhost/api/github/webhook/${setup.workspace.id}`,
        payload,
        signature,
        setup.repository.githubWebhookId!,
      );
      const response = await POST(request, { params: { workspaceId: setup.workspace.id } });
      if (extras?.waitForDispatch !== false) {
        await vi.mocked(dispatchIncrementalProtectReview).mock.results.at(-1)?.value;
      }
      return response;
    }

    test('does not await incremental dispatch before triggerAsyncSync', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);

      let resolveDispatch: (value: { dispatched: false; reason: string }) => void = () => {};
      const hung = new Promise<{ dispatched: false; reason: string }>((resolve) => {
        resolveDispatch = resolve;
      });
      vi.mocked(dispatchIncrementalProtectReview).mockReturnValue(hung);

      const response = await sendPush(testSetup, { waitForDispatch: false });
      expect(response.status).toBe(202);
      expect(triggerAsyncSync).toHaveBeenCalled();
      expect(vi.mocked(dispatchIncrementalProtectReview).mock.results.at(-1)?.value).toBe(hung);

      resolveDispatch({ dispatched: false, reason: 'test' });
      await hung;
    });

    test('does not dispatch incremental scan before the first completed full review', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);

      const response = await sendPush(testSetup);
      expect(response.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(0);
      expect(mockStakworkRequest).not.toHaveBeenCalled();
      expect(triggerAsyncSync).toHaveBeenCalled();
    });

    test('dispatches incremental scan after a completed full review using before/after/ref', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);

      const response = await sendPush(testSetup, {
        before: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        after: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      expect(response.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].repositoryUrl).toBe(testSetup.repository.repositoryUrl);
      expect(runs[0].status).toBe('running');

      expect(mockStakworkRequest).toHaveBeenCalled();
      const vars = (
        mockStakworkRequest.mock.calls[0][1] as {
          workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
        }
      ).workflow_params.set_var.attributes.vars;
      expect(vars).toMatchObject({
        mode: 'incremental',
        repositoryUrl: testSetup.repository.repositoryUrl,
        before: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        after: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ref: 'refs/heads/main',
      });
      expect(vars).not.toHaveProperty('pat');
      expect(vars).not.toHaveProperty('swarmApiKey');
      expect(triggerAsyncSync).toHaveBeenCalled();
    });

    test('incremental dispatch Stakwork vars include the resolved model and credential fields', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      await db.llmModel.create({
        data: {
          name: 'claude-sonnet-4',
          provider: 'ANTHROPIC',
          inputPricePer1M: 3,
          outputPricePer1M: 15,
          isPublic: true,
          isTaskDefault: true,
        },
      });

      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);
      await db.janitorConfig.update({
        where: { workspaceId: testSetup.workspace.id },
        data: { securityReviewModel: 'anthropic/claude-sonnet-4' },
      });

      const response = await sendPush(testSetup, {
        before: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        after: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      expect(response.status).toBe(202);

      expect(mockStakworkRequest).toHaveBeenCalled();
      const vars = (
        mockStakworkRequest.mock.calls[0][1] as {
          workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
        }
      ).workflow_params.set_var.attributes.vars;
      expect(vars.model).toBe('anthropic/claude-sonnet-4');
      expect(typeof vars.apiKey).toBe('string');
      expect(vars.apiKey).toBeTruthy();
    });

    test('still dispatches incremental scan when codeIngestionEnabled is false', async () => {
      testSetup = await createWebhookTestScenario({
        branch: 'main',
        codeIngestionEnabled: false,
      });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);

      const response = await sendPush(testSetup);
      expect(response.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(1);
      expect(mockStakworkRequest).toHaveBeenCalled();
      expect(triggerAsyncSync).not.toHaveBeenCalled();
    });

    test('debounce prevents duplicate incremental dispatch on rapid repeated pushes', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);

      const first = await sendPush(testSetup);
      const second = await sendPush(testSetup, {
        before: 'cccccccccccccccccccccccccccccccccccccccc',
        after: 'dddddddddddddddddddddddddddddddddddddddd',
      });
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(1);
    });

    test('skips incremental scan when the pushed repo is out of Protect scope', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await completeFullReview(testSetup.workspace.id, testSetup.repository);

      const response = await sendPush(testSetup);
      expect(response.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(0);
      expect(mockStakworkRequest).not.toHaveBeenCalled();
    });

    test('skips incremental scan when the repo is in live scope but never fully scanned', async () => {
      testSetup = await createWebhookTestScenario({ branch: 'main' });
      await enableProtect(testSetup.workspace.id);
      await addToScope(testSetup.workspace.id, testSetup.repository.id);
      await completeFullReview(testSetup.workspace.id);

      const response = await sendPush(testSetup);
      expect(response.status).toBe(202);

      const runs = await db.protectReviewRun.findMany({
        where: { workspaceId: testSetup.workspace.id, mode: 'incremental' },
      });
      expect(runs).toHaveLength(0);
      expect(mockStakworkRequest).not.toHaveBeenCalled();
    });
  });
});
