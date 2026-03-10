import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
} from '@/__tests__/support/fixtures';
import { GET } from '@/app/api/features/[featureId]/image/route';
import { getServerSession } from 'next-auth';

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

describe('GET /api/features/[featureId]/image', () => {
  const createRequest = (featureId: string, path?: string) => {
    const url = new URL(`http://localhost/api/features/${featureId}/image`);
    if (path !== undefined) {
      url.searchParams.set('path', path);
    }
    return new Request(url.toString());
  };

  beforeEach(async () => {
    await db.feature.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();

    vi.clearAllMocks();
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example.com/fresh-presigned-url');
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue(null);

      const response = await GET(
        createRequest(feature.id, 'features/ws/swarm/feat/file.png'),
        { params: Promise.resolve({ featureId: feature.id }) }
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Authorization', () => {
    it('should return 403 for users without workspace access', async () => {
      const owner = await createTestUser();
      const outsider = await createTestUser({ email: 'outsider@example.com' });
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: outsider.id, email: outsider.email },
      });

      const response = await GET(
        createRequest(feature.id, 'features/ws/swarm/feat/file.png'),
        { params: Promise.resolve({ featureId: feature.id }) }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('Validation', () => {
    it('should return 404 if feature does not exist', async () => {
      const owner = await createTestUser();

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: owner.id, email: owner.email },
      });

      const response = await GET(
        createRequest('non-existent-feature-id', 'features/ws/swarm/feat/file.png'),
        { params: Promise.resolve({ featureId: 'non-existent-feature-id' }) }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Feature not found');
    });

    it('should return 400 when path query param is missing', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: owner.id, email: owner.email },
      });

      const response = await GET(
        createRequest(feature.id), // no path param
        { params: Promise.resolve({ featureId: feature.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('path query parameter is required');
    });

    it('should return 400 when path does not start with features/ (path traversal guard)', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: owner.id, email: owner.email },
      });

      const maliciousPaths = [
        '../etc/passwd',
        'tasks/some-task/file.png',
        '/etc/passwd',
        'other/path/file.png',
      ];

      for (const badPath of maliciousPaths) {
        const response = await GET(
          createRequest(feature.id, badPath),
          { params: Promise.resolve({ featureId: feature.id }) }
        );

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("Invalid path: must start with 'features/'");
      }
    });
  });

  describe('Success', () => {
    it('should return a fresh presigned URL for a valid request', async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: owner.id, email: owner.email },
      });

      const s3Path = `features/${workspace.id}/swarm-id/${feature.id}/1234567890_abc_screenshot.png`;

      const response = await GET(
        createRequest(feature.id, s3Path),
        { params: Promise.resolve({ featureId: feature.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/fresh-presigned-url');
      expect(data.expiresIn).toBe(3600);

      // Assert generatePresignedDownloadUrl was called with the correct key and expiry
      expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(s3Path, 3600);
    });

    it('should allow workspace members (non-owner) to retrieve image URLs', async () => {
      const owner = await createTestUser();
      const member = await createTestUser({ email: 'member@example.com' });
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: 'DEVELOPER',
        },
      });

      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: member.id, email: member.email },
      });

      const s3Path = `features/${workspace.id}/swarm-id/${feature.id}/file.png`;

      const response = await GET(
        createRequest(feature.id, s3Path),
        { params: Promise.resolve({ featureId: feature.id }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBe('https://s3.example.com/fresh-presigned-url');
      expect(data.expiresIn).toBe(3600);
    });
  });
});
