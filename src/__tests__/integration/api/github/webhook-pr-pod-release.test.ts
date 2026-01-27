/**
 * Integration tests for GitHub webhook PR merged auto-release pod functionality
 */
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '@/app/api/github/webhook/[workspaceId]/route';
import { RepositoryStatus, ArtifactType, TaskStatus, WorkflowStatus } from '@prisma/client';
import {
  createWebhookTestScenario,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
} from '@/__tests__/support/factories/github-webhook.factory';
import { resetDatabase } from '@/__tests__/support/utilities/database';
import { db } from '@/lib/db';
import { triggerAsyncSync } from '@/services/swarm/stakgraph-actions';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { pusherServer, PUSHER_EVENTS } from '@/lib/pusher';
import { releaseTaskPod } from '@/lib/pods/utils';
import { generateUniqueId } from '@/__tests__/support/helpers';
import { EncryptionService } from '@/lib/encryption';

// Mock external services
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: 'workspace-task-title-update',
    PR_STATUS_CHANGE: 'pr-status-change',
  },
}));
vi.mock('@/services/roadmap/feature-status-sync', () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/pods/utils', async () => {
  const actual = await vi.importActual('@/lib/pods/utils');
  return {
    ...actual,
    releaseTaskPod: vi.fn(),
  };
});

const encryptionService = EncryptionService.getInstance();

describe('POST /api/github/webhook/[workspaceId] - PR Merged Pod Release', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Setup default successful mocks
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

  describe('PR Merged - Pod Release Logic', () => {
    test('should release pod when PR is merged and task has pod assigned', async () => {
      // Create test scenario
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create task with pod assigned
      const task = await db.task.create({
        data: {
          title: 'Test Task with Pod',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-123',
          agentUrl: 'https://test-pod.example.com',
          agentPassword: JSON.stringify(
            encryptionService.encryptField('agentPassword', 'test-password')
          ),
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      // Create chat message
      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      // Create PR artifact
      const prUrl = 'https://github.com/test-owner/test-repo/pull/123';
      const artifact = await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Mock successful pod release
      vi.mocked(releaseTaskPod).mockResolvedValue({
        success: true,
        podDropped: true,
        taskCleared: true,
      });

      // Create PR merged webhook payload
      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 on successful pod release
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify task status was updated to DONE
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { status: true },
      });
      expect(updatedTask?.status).toBe(TaskStatus.DONE);

      // Verify PR artifact status was updated to "DONE"
      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
        select: { content: true },
      });
      expect(updatedArtifact?.content).toMatchObject({
        repo: 'test-owner/test-repo',
        url: prUrl,
        status: 'DONE',
      });

      // Verify Pusher trigger was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${testSetup.workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          status: TaskStatus.DONE,
          archived: false,
        })
      );

      // Verify releaseTaskPod was called with correct params
      expect(releaseTaskPod).toHaveBeenCalledWith({
        taskId: task.id,
        podId: 'test-pod-123',
        workspaceId: testSetup.workspace.id,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });
    });

    test('should update task status and artifact when PR is merged for task without pod', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create task WITHOUT pod assigned
      const task = await db.task.create({
        data: {
          title: 'Test Task without Pod',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.TODO,
          workflowStatus: WorkflowStatus.PENDING,
          podId: null, // No pod assigned
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      // Create chat message
      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      // Create PR artifact
      const prUrl = 'https://github.com/test-owner/test-repo/pull/456';
      const artifact = await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-456',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 (task processed successfully, no pod to release)
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.tasksProcessed).toBe(1);
      expect(body.podsReleased).toBe(0);

      // Verify task status was updated to DONE
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { status: true },
      });
      expect(updatedTask?.status).toBe(TaskStatus.DONE);

      // Verify PR artifact status was updated to "DONE"
      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
        select: { content: true },
      });
      expect(updatedArtifact?.content).toMatchObject({
        repo: 'test-owner/test-repo',
        url: prUrl,
        status: 'DONE',
      });

      // Verify Pusher trigger was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${testSetup.workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          status: TaskStatus.DONE,
          archived: false,
        })
      );

      // Verify releaseTaskPod was NOT called (no pod)
      expect(releaseTaskPod).not.toHaveBeenCalled();
    });

    test('should handle multiple tasks with same PR URL and release all pods', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const prUrl = 'https://github.com/test-owner/test-repo/pull/789';

      // Create first task with pod
      const task1 = await db.task.create({
        data: {
          title: 'Test Task 1',
          description: 'Task 1 description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-111',
          agentUrl: 'https://test-pod-111.example.com',
          agentPassword: JSON.stringify(
            encryptionService.encryptField('agentPassword', 'test-password-1')
          ),
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message1 = await db.chatMessage.create({
        data: {
          taskId: task1.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const artifact1 = await db.artifact.create({
        data: {
          messageId: message1.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Create second task with pod (same PR URL)
      const task2 = await db.task.create({
        data: {
          title: 'Test Task 2',
          description: 'Task 2 description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-222',
          agentUrl: 'https://test-pod-222.example.com',
          agentPassword: JSON.stringify(
            encryptionService.encryptField('agentPassword', 'test-password-2')
          ),
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message2 = await db.chatMessage.create({
        data: {
          taskId: task2.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const artifact2 = await db.artifact.create({
        data: {
          messageId: message2.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Mock successful pod releases for both tasks
      vi.mocked(releaseTaskPod).mockResolvedValue({
        success: true,
        podDropped: true,
        taskCleared: true,
      });

      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-789',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 (all tasks processed successfully)
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.tasksProcessed).toBe(2);
      expect(body.podsReleased).toBe(2);

      // Verify both tasks' status updated to DONE
      const updatedTask1 = await db.task.findUnique({
        where: { id: task1.id },
        select: { status: true },
      });
      expect(updatedTask1?.status).toBe(TaskStatus.DONE);

      const updatedTask2 = await db.task.findUnique({
        where: { id: task2.id },
        select: { status: true },
      });
      expect(updatedTask2?.status).toBe(TaskStatus.DONE);

      // Verify both artifacts updated
      const updatedArtifact1 = await db.artifact.findUnique({
        where: { id: artifact1.id },
        select: { content: true },
      });
      expect(updatedArtifact1?.content).toMatchObject({
        status: 'DONE',
      });

      const updatedArtifact2 = await db.artifact.findUnique({
        where: { id: artifact2.id },
        select: { content: true },
      });
      expect(updatedArtifact2?.content).toMatchObject({
        status: 'DONE',
      });

      // Verify releaseTaskPod was called for both tasks
      expect(releaseTaskPod).toHaveBeenCalledTimes(2);
      expect(releaseTaskPod).toHaveBeenCalledWith({
        taskId: task1.id,
        podId: 'test-pod-111',
        workspaceId: testSetup.workspace.id,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });
      expect(releaseTaskPod).toHaveBeenCalledWith({
        taskId: task2.id,
        podId: 'test-pod-222',
        workspaceId: testSetup.workspace.id,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });

      // Verify Pusher triggers for both tasks
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${testSetup.workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task1.id,
          status: TaskStatus.DONE,
        })
      );
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${testSetup.workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task2.id,
          status: TaskStatus.DONE,
        })
      );
    });

    test('should handle pod reassignment gracefully', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create task with pod assigned
      const task = await db.task.create({
        data: {
          title: 'Test Task with Reassigned Pod',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-999',
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const prUrl = 'https://github.com/test-owner/test-repo/pull/999';
      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Mock pod ownership verification failure (reassigned)
      vi.mocked(releaseTaskPod).mockResolvedValue({
        success: true,
        podDropped: false,
        taskCleared: true,
        reassigned: true,
      });

      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-999',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 (task processed, pod was reassigned so not dropped)
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.tasksProcessed).toBe(1);
      expect(body.podsReleased).toBe(0); // Pod was reassigned, not dropped

      // Verify releaseTaskPod was called
      expect(releaseTaskPod).toHaveBeenCalled();
    });

    test('should update artifact status to CLOSED when PR is closed without merge', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create task with pod assigned
      const task = await db.task.create({
        data: {
          title: 'Test Task',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-000',
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const prUrl = 'https://github.com/test-owner/test-repo/pull/000';
      const artifact = await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Create PR closed WITHOUT merge payload
      const prPayload = createGitHubPullRequestPayload(
        'closed',
        false, // NOT merged
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-000',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 with success
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.tasksProcessed).toBe(1);

      // Verify task status was NOT changed
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { status: true },
      });
      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);

      // Verify PR artifact status was updated to "CLOSED"
      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
        select: { content: true },
      });
      expect(updatedArtifact?.content).toMatchObject({
        repo: 'test-owner/test-repo',
        url: prUrl,
        status: 'CLOSED',
      });

      // Verify Pusher event was sent to task channel
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        PUSHER_EVENTS.PR_STATUS_CHANGE,
        expect.objectContaining({
          taskId: task.id,
          prUrl: prUrl,
          state: 'closed',
          artifactStatus: 'CLOSED',
        })
      );

      // Verify releaseTaskPod was NOT called
      expect(releaseTaskPod).not.toHaveBeenCalled();
    });

    test('should handle PR opened action gracefully', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      const prPayload = createGitHubPullRequestPayload(
        'opened', // PR opened, not closed
        false,
        'https://github.com/test-owner/test-repo/pull/111',
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-111',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 202 (acknowledged but no action)
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify releaseTaskPod was NOT called
      expect(releaseTaskPod).not.toHaveBeenCalled();
    });

    test('should handle releaseTaskPod failure gracefully', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create task with pod assigned
      const task = await db.task.create({
        data: {
          title: 'Test Task',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          podId: 'test-pod-fail',
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const prUrl = 'https://github.com/test-owner/test-repo/pull/fail';
      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      // Mock releaseTaskPod failure
      vi.mocked(releaseTaskPod).mockResolvedValue({
        success: false,
        podDropped: false,
        taskCleared: false,
        error: 'Failed to connect to pool manager',
      });

      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-fail',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 200 (task processed despite pod release failure)
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.tasksProcessed).toBe(1);
      expect(body.podsReleased).toBe(0); // Pod release failed

      // Verify releaseTaskPod was called
      expect(releaseTaskPod).toHaveBeenCalled();
    });

    test('should handle archived tasks correctly', async () => {
      const testSetup = await createWebhookTestScenario({
        branch: 'main',
        status: RepositoryStatus.SYNCED,
      });

      // Create ARCHIVED task with pod
      const task = await db.task.create({
        data: {
          title: 'Archived Task',
          description: 'Task description',
          workspaceId: testSetup.workspace.id,
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
          podId: 'test-pod-archived',
          archived: true, // Task is archived
          createdById: testSetup.user.id,
          updatedById: testSetup.user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          role: 'ASSISTANT',
          message: 'PR created',
          
          status: 'SENT',
        },
      });

      const prUrl = 'https://github.com/test-owner/test-repo/pull/archived';
      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: 'test-owner/test-repo',
            url: prUrl,
            status: 'open',
          },
        },
      });

      const prPayload = createGitHubPullRequestPayload(
        'closed',
        true,
        prUrl,
        testSetup.repository.repositoryUrl
      );

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
            'x-github-delivery': 'pr-delivery-archived',
            'x-github-hook-id': testSetup.repository.githubWebhookId!,
          },
          body: JSON.stringify(prPayload),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
      });

      // Should return 202 (archived tasks excluded from query)
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify releaseTaskPod was NOT called (archived task)
      expect(releaseTaskPod).not.toHaveBeenCalled();
    });
  });
});
