import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/tasks/[taskId]/artifacts/[artifactId]/url/route';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { ArtifactType, WorkflowStatus } from '@prisma/client';
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestChatMessage,
} from '@/__tests__/support/fixtures';
import {
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  generateUniqueId,
} from '@/__tests__/support/helpers';

// Mock S3 service
const mockS3Service = {
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

// Mock NextAuth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

describe('GET /api/tasks/[taskId]/artifacts/[artifactId]/url', () => {
  const mockGetServerSession = vi.mocked(getServerSession);
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testArtifact: any;
  let testMessage: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test fixtures
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testTask = await createTestTask({
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      status: 'TODO',
    });

    // Create test message (required for artifact relation)
    testMessage = await createTestChatMessage({
      taskId: testTask.id,
      message: 'Test message',
      role: 'ASSISTANT',
    });

    // Create test artifact with MEDIA type
    testArtifact = await db.artifact.create({
      data: {
        id: generateUniqueId('artifact'),
        type: ArtifactType.MEDIA,
        messageId: testMessage.id,
        content: {
          s3Key: 'uploads/workspace123/swarm456/task789/test-video.mp4',
          url: 'https://example.com/video.mp4',
          mimeType: 'video/mp4',
        },
      },
    });
  });

  describe('Authentication', () => {
    test('should return 401 for unauthenticated request', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectUnauthorized(response);
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    test('should return 401 for session without user', async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectUnauthorized(response);
    });

    test('should allow authenticated user with workspace access', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?signature=abc123'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe('Authorization & Access Control', () => {
    test('should return 403 for user without workspace access', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      mockGetServerSession.mockResolvedValue({ user: { id: otherUser.id, email: otherUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectForbidden(response);
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    test('should allow workspace owner to access artifact URL', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
    });

    test('should allow workspace admin to access artifact URL', async () => {
      const adminUser = await createTestUser({ email: 'admin@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: adminUser.id,
          workspaceId: testWorkspace.id,
          role: 'ADMIN',
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: adminUser.id, email: adminUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
    });

    test('should allow workspace developer to access artifact URL', async () => {
      const developerUser = await createTestUser({ email: 'developer@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: developerUser.id,
          workspaceId: testWorkspace.id,
          role: 'DEVELOPER',
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: developerUser.id, email: developerUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
    });

    test('should allow workspace viewer to access artifact URL', async () => {
      const viewerUser = await createTestUser({ email: 'viewer@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: viewerUser.id,
          workspaceId: testWorkspace.id,
          role: 'VIEWER',
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: viewerUser.id, email: viewerUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe('Input Validation', () => {
    test('should return 400 for missing taskId', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks//artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: '', artifactId: testArtifact.id }),
      });

      await expectError(response, 'Task ID and Artifact ID required', 400);
    });

    test('should return 400 for missing artifactId', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts//url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: '' }),
      });

      await expectError(response, 'Task ID and Artifact ID required', 400);
    });

    test('should return 400 for both missing taskId and artifactId', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks//artifacts//url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: '', artifactId: '' }),
      });

      await expectError(response, 'Task ID and Artifact ID required', 400);
    });
  });

  describe('Not Found Scenarios', () => {
    test('should return 404 for non-existent artifact', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/non-existent-artifact-id/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: 'non-existent-artifact-id',
        }),
      });

      await expectNotFound(response, 'Artifact not found');
    });

    test('should return 400 for artifact belonging to different task', async () => {
      // Create another task with artifact
      const otherTask = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        status: 'TODO',
      });
      const otherMessage = await createTestChatMessage({
        taskId: otherTask.id,
        message: 'Other message',
        role: 'ASSISTANT',
      });
      const otherArtifact = await db.artifact.create({
        data: {
          id: generateUniqueId('other'),
          type: ArtifactType.MEDIA,
          messageId: otherMessage.id,
          content: { s3Key: 'test-key' },
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${otherArtifact.id}/url`
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: otherArtifact.id,
        }),
      });

      await expectError(response, 'Artifact does not belong to this task', 400);
    });
  });

  describe('Artifact Validation', () => {
    test('should return 400 if artifact does not belong to specified task', async () => {
      // Create another task with its own artifact
      const otherTask = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        status: 'TODO',
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${otherTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: otherTask.id,
          artifactId: testArtifact.id,
        }),
      });

      await expectError(response, 'Artifact does not belong to this task', 400);
    });

    test('should return 400 if artifact is not MEDIA type', async () => {
      // Create non-MEDIA artifact
      const codeArtifact = await db.artifact.create({
        data: {
          id: generateUniqueId('code'),
          type: ArtifactType.CODE,
          messageId: testMessage.id,
          content: {
            language: 'typescript',
            code: 'const x = 1;',
          },
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${codeArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: codeArtifact.id,
        }),
      });

      await expectError(response, 'Artifact is not a media type', 400);
    });

    test('should return 400 if artifact has no S3 key', async () => {
      // Create artifact without S3 key
      const invalidArtifact = await db.artifact.create({
        data: {
          id: generateUniqueId('invalid'),
          type: ArtifactType.MEDIA,
          messageId: testMessage.id,
          content: {
            url: 'https://example.com/video.mp4',
            mimeType: 'video/mp4',
          },
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${invalidArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: invalidArtifact.id,
        }),
      });

      await expectError(response, 'Artifact does not have an S3 key', 400);
    });
  });

  describe('Presigned URL Generation', () => {
    test('should generate presigned URL with correct S3 key', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?signature=abc123'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'uploads/workspace123/swarm456/task789/test-video.mp4',
        3600
      );
    });

    test('should return presigned URL with correct expiry time (1 hour)', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.expiresIn).toBe(3600);
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        expect.any(String),
        3600
      );
    });

    test('should return complete response with url and expiresIn', async () => {
      const mockPresignedUrl =
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?X-Amz-Signature=abc123';
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(mockPresignedUrl);

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty('url');
      expect(data).toHaveProperty('expiresIn');
      expect(data.url).toBe(mockPresignedUrl);
      expect(data.expiresIn).toBe(3600);
    });
  });

  describe('S3 Service Integration', () => {
    test('should call S3 service with correct parameters', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(1);
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'uploads/workspace123/swarm456/task789/test-video.mp4',
        3600
      );
    });

    test('should not call S3 service on authentication failure', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`
      );
      await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    test('should not call S3 service on authorization failure', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      mockGetServerSession.mockResolvedValue({ user: { id: otherUser.id, email: otherUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should return 500 on S3 service failure', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockRejectedValue(
        new Error('AWS SDK Error: Invalid credentials')
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Internal error');
    });

    test('should handle database errors gracefully', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/malformed-id/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: 'malformed-id',
        }),
      });

      expect([404, 500]).toContain(response.status);
    });
  });

  describe('Edge Cases', () => {
    test('should handle artifact with null content', async () => {
      const nullContentArtifact = await db.artifact.create({
        data: {
          id: generateUniqueId('null-content'),
          type: ArtifactType.MEDIA,
          messageId: testMessage.id,
          content: null,
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${nullContentArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: nullContentArtifact.id,
        }),
      });

      await expectError(response, 'Artifact does not have an S3 key', 400);
    });

    test('should handle artifact with empty object content', async () => {
      const emptyContentArtifact = await db.artifact.create({
        data: {
          id: generateUniqueId('empty-content'),
          type: ArtifactType.MEDIA,
          messageId: testMessage.id,
          content: {},
        },
      });

      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${emptyContentArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({
          taskId: testTask.id,
          artifactId: emptyContentArtifact.id,
        }),
      });

      await expectError(response, 'Artifact does not have an S3 key', 400);
    });

    test('should handle concurrent requests for same artifact', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request1 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const request2 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );

      const [response1, response2] = await Promise.all([
        GET(request1, {
          params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
        }),
        GET(request2, {
          params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
        }),
      ]);

      await expectSuccess(response1, 200);
      await expectSuccess(response2, 200);
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('Data Consistency', () => {
    test('should return fresh presigned URLs for multiple requests', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });

      let callCount = 0;
      mockS3Service.generatePresignedDownloadUrl.mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          `https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?call=${callCount}`
        );
      });

      const request1 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response1 = await GET(request1, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });
      const data1 = await expectSuccess(response1, 200);

      const request2 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response2 = await GET(request2, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });
      const data2 = await expectSuccess(response2, 200);

      expect(data1.url).not.toBe(data2.url);
      expect(data1.expiresIn).toBe(3600);
      expect(data2.expiresIn).toBe(3600);
    });

    test('should maintain artifact-task relationship integrity', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: testUser.id, email: testUser.email }, expires: new Date(Date.now() + 86400000).toISOString() });
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
        'https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url'
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/artifacts/${testArtifact.id}/url`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id, artifactId: testArtifact.id }),
      });

      await expectSuccess(response, 200);

      // Verify artifact still belongs to correct task in database
      const artifact = await db.artifact.findUnique({
        where: { id: testArtifact.id },
        include: { message: { include: { task: true } } },
      });
      expect(artifact?.message?.task?.id).toBe(testTask.id);
    });
  });
});
