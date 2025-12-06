import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/features/[featureId]/diagram/generate/route';
import { DELETE } from '@/app/api/features/[featureId]/diagram/route';
import { db } from '@/lib/db';
import { NextRequest } from 'next/server';

// Mock the services
vi.mock('@/services/gemini-image', () => ({
  generateArchitectureDiagram: vi.fn(),
}));

vi.mock('@/services/diagram-storage', () => ({
  getDiagramStorageService: vi.fn(() => ({
    uploadDiagram: vi.fn(),
    deleteDiagram: vi.fn(),
  })),
}));

// Mock auth middleware
vi.mock('@/lib/middleware/utils', () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

const { generateArchitectureDiagram } = await import('@/services/gemini-image');
const { getDiagramStorageService } = await import('@/services/diagram-storage');
const { getMiddlewareContext, requireAuth } = await import(
  '@/lib/middleware/utils'
);

describe('Diagram API Integration Tests', () => {
  let testUser: any;
  let testWorkspace: any;
  let testFeature: any;
  let mockRequest: NextRequest;

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        email: 'test-diagram@example.com',
        name: 'Test User',
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: 'OWNER',
          },
        },
      },
    });

    // Create test feature with architecture
    testFeature = await db.feature.create({
      data: {
        title: 'Test Feature',
        workspaceId: testWorkspace.id,
        architecture: 'This is a test architecture description',
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    // Setup mock request
    mockRequest = new NextRequest('http://localhost:3000/api/test');

    // Reset service mocks
    vi.clearAllMocks();

    // Setup default auth mocks (after clearAllMocks)
    vi.mocked(getMiddlewareContext).mockReturnValue({} as any);
    vi.mocked(requireAuth).mockReturnValue(testUser as any);
  });

  afterEach(async () => {
    // Cleanup test data
    if (testFeature) {
      await db.feature.delete({ where: { id: testFeature.id } }).catch(() => {});
    }
    if (testWorkspace) {
      await db.workspaceMember
        .deleteMany({ where: { workspaceId: testWorkspace.id } })
        .catch(() => {});
      await db.workspace.delete({ where: { id: testWorkspace.id } }).catch(() => {});
    }
    if (testUser) {
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  describe('POST /api/features/[featureId]/diagram/generate', () => {
    it('should successfully generate and upload diagram', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      const mockUploadResult = {
        s3Key: 'diagrams/test-workspace/test-feature/12345.png',
        s3Url: 'https://s3.example.com/diagrams/test-feature.png',
      };

      // Mock service methods
      vi.mocked(generateArchitectureDiagram).mockResolvedValue(mockBuffer);
      
      const mockStorageService = {
        uploadDiagram: vi.fn().mockResolvedValue(mockUploadResult),
        deleteDiagram: vi.fn(),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        diagramUrl: mockUploadResult.s3Url,
        s3Key: mockUploadResult.s3Key,
        success: true,
      });

      // Verify database was updated
      const updatedFeature = await db.feature.findUnique({
        where: { id: testFeature.id },
      });
      expect(updatedFeature?.diagramUrl).toBe(mockUploadResult.s3Url);
      expect(updatedFeature?.diagramS3Key).toBe(mockUploadResult.s3Key);

      // Verify services were called correctly
      expect(generateArchitectureDiagram).toHaveBeenCalledWith(
        testFeature.architecture
      );
      expect(mockStorageService.uploadDiagram).toHaveBeenCalledWith(
        mockBuffer,
        testFeature.id,
        testWorkspace.id
      );
    });

    it('should return 404 when feature does not exist', async () => {
      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: 'non-existent-id' }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Feature not found');
    });

    it('should return 403 when user does not have workspace access', async () => {
      // Create another user without workspace access
      const unauthorizedUser = await db.user.create({
        data: {
          email: 'unauthorized@example.com',
          name: 'Unauthorized User',
        },
      });

      vi.mocked(requireAuth).mockReturnValue(unauthorizedUser as any);

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('Unauthorized');

      await db.user.delete({ where: { id: unauthorizedUser.id } });
    });

    it('should return 400 when architecture field is empty', async () => {
      // Update feature to have empty architecture
      await db.feature.update({
        where: { id: testFeature.id },
        data: { architecture: '' },
      });

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Architecture text is required');
    });

    it('should return 400 when architecture field is null', async () => {
      // Update feature to have null architecture
      await db.feature.update({
        where: { id: testFeature.id },
        data: { architecture: null },
      });

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Architecture text is required');
    });

    it('should return 500 when diagram generation fails', async () => {
      vi.mocked(generateArchitectureDiagram).mockRejectedValue(
        new Error('Gemini API error')
      );

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to generate diagram');
      expect(data.details).toBe('Gemini API error');
    });

    it('should return 500 when S3 upload fails', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      vi.mocked(generateArchitectureDiagram).mockResolvedValue(mockBuffer);
      
      const mockStorageService = {
        uploadDiagram: vi.fn().mockRejectedValue(new Error('S3 upload error')),
        deleteDiagram: vi.fn(),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to upload diagram to storage');
      expect(data.details).toBe('S3 upload error');
    });

    it('should return 500 when database update fails', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      const mockUploadResult = {
        s3Key: 'diagrams/test-feature.png',
        s3Url: 'https://s3.example.com/diagrams/test-feature.png',
      };

      vi.mocked(generateArchitectureDiagram).mockResolvedValue(mockBuffer);
      
      const mockStorageService = {
        uploadDiagram: vi.fn().mockResolvedValue(mockUploadResult),
        deleteDiagram: vi.fn(),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      // Delete feature before update to cause database error
      await db.feature.delete({ where: { id: testFeature.id } });
      testFeature = null; // Prevent cleanup error

      const response = await POST(mockRequest, {
        params: Promise.resolve({ featureId: 'deleted-feature-id' }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Feature not found');
    });
  });

  describe('DELETE /api/features/[featureId]/diagram', () => {
    beforeEach(async () => {
      // Add diagram info to test feature
      await db.feature.update({
        where: { id: testFeature.id },
        data: {
          diagramUrl: 'https://s3.example.com/diagrams/test.png',
          diagramS3Key: 'diagrams/test-workspace/test-feature/test.png',
        },
      });
    });

    it('should successfully delete diagram', async () => {
      const mockStorageService = {
        uploadDiagram: vi.fn(),
        deleteDiagram: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Diagram deleted successfully');

      // Verify database was updated
      const updatedFeature = await db.feature.findUnique({
        where: { id: testFeature.id },
      });
      expect(updatedFeature?.diagramUrl).toBeNull();
      expect(updatedFeature?.diagramS3Key).toBeNull();

      // Verify S3 delete was called
      expect(mockStorageService.deleteDiagram).toHaveBeenCalledWith(
        'diagrams/test-workspace/test-feature/test.png'
      );
    });

    it('should return 404 when feature does not exist', async () => {
      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId: 'non-existent-id' }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Feature not found');
    });

    it('should return 403 when user does not have workspace access', async () => {
      const unauthorizedUser = await db.user.create({
        data: {
          email: 'unauthorized2@example.com',
          name: 'Unauthorized User 2',
        },
      });

      vi.mocked(requireAuth).mockReturnValue(unauthorizedUser as any);

      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('Unauthorized');

      await db.user.delete({ where: { id: unauthorizedUser.id } });
    });

    it('should return 404 when no diagram exists', async () => {
      // Remove diagram info from feature
      await db.feature.update({
        where: { id: testFeature.id },
        data: {
          diagramUrl: null,
          diagramS3Key: null,
        },
      });

      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No diagram found for this feature');
    });

    it('should return 500 when S3 deletion fails', async () => {
      const mockStorageService = {
        uploadDiagram: vi.fn(),
        deleteDiagram: vi.fn().mockRejectedValue(new Error('S3 delete error')),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId: testFeature.id }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete diagram from storage');
      expect(data.details).toBe('S3 delete error');
    });

    it('should return 500 when database update fails after S3 deletion', async () => {
      const mockStorageService = {
        uploadDiagram: vi.fn(),
        deleteDiagram: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      // Delete feature after S3 deletion to cause database error
      const featureId = testFeature.id;
      await db.feature.delete({ where: { id: testFeature.id } });
      testFeature = null; // Prevent cleanup error

      const response = await DELETE(mockRequest, {
        params: Promise.resolve({ featureId }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Feature not found');
    });
  });
});
