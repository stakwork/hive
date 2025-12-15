import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestChatMessage,
  createTestArtifact,
} from '@/__tests__/support/fixtures';
import { GET } from '@/app/api/tasks/[taskId]/artifacts/[artifactId]/url/route';
import { getServerSession } from 'next-auth';
import type { MediaContent } from '@/lib/chat';

// Create mock function at top level (before vi.mock calls)
const mockGeneratePresignedDownloadUrl = vi.fn();

// Mock S3Service
vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  })),
}));

// Mock NextAuth
vi.mock('next-auth');

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

describe('GET /api/tasks/[taskId]/artifacts/[artifactId]/url', () => {
  // Helper to create request with proper URL
  const createRequest = (taskId: string, artifactId: string) => {
    const url = new URL(`http://localhost/api/tasks/${taskId}/artifacts/${artifactId}/url`);
    return new Request(url.toString());
  };


  beforeEach(async () => {
    // Clean up database before each test
    await db.artifact.deleteMany();
    await db.chatMessage.deleteMany();
    await db.task.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Setup S3 mock
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  describe('Authentication', () => {
    it('should reject requests without authentication', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      vi.mocked(getServerSession).mockResolvedValue(null);

      const url = new URL(`http://localhost/api/tasks/${task.id}/artifacts/${artifact.id}/url`);
      const request = new Request(url.toString());
      const response = await GET(
        request,
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Authorization', () => {
    it('should reject requests from non-workspace members', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: owner.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      // Create a different user not in the workspace
      const outsider = await createTestUser({ email: 'outsider@example.com' });
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: outsider.id, email: outsider.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });

    it('should allow workspace members to retrieve artifact URLs', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: owner.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      // Create a workspace member
      const member = await createTestUser({ email: 'member@example.com' });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: 'DEVELOPER',
        },
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: member.id, email: member.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/presigned-url');
      expect(data.expiresIn).toBe(3600);
    });

    it('should allow viewers to retrieve artifact URLs', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: owner.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      // Create a viewer
      const viewer = await createTestUser({ email: 'viewer@example.com' });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: viewer.id,
          role: 'VIEWER',
        },
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: viewer.id, email: viewer.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/presigned-url');
      expect(data.expiresIn).toBe(3600);
    });
  });

  describe('Valid Requests', () => {
    it('should successfully retrieve artifact URL for task owner', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/presigned-url');
      expect(data.expiresIn).toBe(3600);
    });

    it('should call S3Service with correct parameters', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'uploads/user-123/file.webm',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith('uploads/user-123/file.webm', 3600);
    });

    it('should handle audio media type', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/audio.webm',
        mediaType: 'audio',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/presigned-url');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for invalid artifact ID', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, "invalid-artifact-id"),
        { params: Promise.resolve({ taskId: task.id, artifactId: 'invalid-artifact-id' }) }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Artifact not found');
    });

    it('should return 400 when artifact does not belong to task', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      
      // Create first task with artifact
      const task1 = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Task 1',
      });
      const message1 = await createTestChatMessage({
        taskId: task1.id,
        message: 'Test message 1',
      });
      const artifact = await createTestArtifact({
        messageId: message1.id,
        s3Key: 'test/video1.webm',
      });

      // Create second task
      const task2 = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Task 2',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      // Try to access task1's artifact via task2's URL
      const response = await GET(
        createRequest(task2.id, artifact.id),
        { params: Promise.resolve({ taskId: task2.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Artifact does not belong to this task');
    });

    it('should return 400 for non-media artifact type', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        type: 'CODE',
        content: { code: 'const x = 1;' },
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Artifact is not a media type');
    });

    it('should return 400 when artifact content lacks S3 key', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      
      // Create artifact with invalid content (no s3Key)
      const artifact = await db.artifact.create({
        data: {
          messageId: message.id,
          type: 'MEDIA',
          content: { filename: 'test.webm' }, // Missing s3Key
        },
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Artifact does not have an S3 key');
    });

    it('should handle S3 service errors gracefully', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      // Mock S3Service to throw an error
      mockGeneratePresignedDownloadUrl.mockRejectedValue(new Error('S3 service error'));

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Internal error');
    });

    it('should return 400 for missing task ID', async () => {
      const user = await createTestUser();
      await createTestWorkspace({ ownerId: user.id });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest("", "some-id"),
        { params: Promise.resolve({ taskId: '', artifactId: 'some-id' }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Task ID and Artifact ID required');
    });

    it('should return 400 for missing artifact ID', async () => {
      const user = await createTestUser();
      await createTestWorkspace({ ownerId: user.id });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest("some-task", ""),
        { params: Promise.resolve({ taskId: 'some-task', artifactId: '' }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Task ID and Artifact ID required');
    });
  });

  describe('Multiple Artifacts', () => {
    it('should retrieve correct URL for specific artifact when task has multiple artifacts', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });

      // Create multiple artifacts for the same message
      const artifact1 = await createTestArtifact({
        messageId: message.id,
        filename: 'file1.webm',
        s3Key: 'uploads/file1.webm',
      });
      const artifact2 = await createTestArtifact({
        messageId: message.id,
        filename: 'file2.webm',
        s3Key: 'uploads/file2.webm',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      // Mock S3Service to return different URLs based on path
      mockGeneratePresignedDownloadUrl.mockImplementation((path: string) => {
        if (path === 'uploads/file1.webm') {
          return Promise.resolve('https://s3.example.com/file1-url');
        } else if (path === 'uploads/file2.webm') {
          return Promise.resolve('https://s3.example.com/file2-url');
        }
        return Promise.resolve('https://s3.example.com/default-url');
      });

      // Request first artifact
      const response1 = await GET(
        createRequest(task.id, artifact1.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact1.id }) }
      );
      expect(response1.status).toBe(200);
      const data1 = await response1.json();
      expect(data1.url).toBe('https://s3.example.com/file1-url');

      // Request second artifact
      const response2 = await GET(
        createRequest(task.id, artifact2.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact2.id }) }
      );
      expect(response2.status).toBe(200);
      const data2 = await response2.json();
      expect(data2.url).toBe('https://s3.example.com/file2-url');
    });
  });

  describe('Edge Cases', () => {
    it('should handle artifact with null content gracefully', async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });
      const message = await createTestChatMessage({
        taskId: task.id,
        message: 'Test message',
      });
      
      // Create artifact with null content
      const artifact = await db.artifact.create({
        data: {
          messageId: message.id,
          type: 'MEDIA',
          content: null,
        },
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest(task.id, artifact.id),
        { params: Promise.resolve({ taskId: task.id, artifactId: artifact.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Artifact does not have an S3 key');
    });

    it('should handle message without task association', async () => {
      const user = await createTestUser();
      await createTestWorkspace({ ownerId: user.id });
      
      // Create orphan message without task
      const message = await db.chatMessage.create({
        data: {
          message: 'Orphan message',
          role: 'USER',
        },
      });
      
      const artifact = await createTestArtifact({
        messageId: message.id,
        s3Key: 'test/video.webm',
      });

      vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id, email: user.email } });

      const response = await GET(
        createRequest("some-task-id", artifact.id),
        { params: Promise.resolve({ taskId: 'some-task-id', artifactId: artifact.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Artifact does not belong to this task');
    });
  });
});
