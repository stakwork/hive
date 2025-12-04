import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3MockWrapper, getMockS3Service } from '@/lib/mock/s3-wrapper';
import { s3MockState } from '@/lib/mock/s3-state';

describe('S3MockWrapper', () => {
  let mockService: S3MockWrapper;

  beforeEach(() => {
    // Reset state and create fresh service instance
    s3MockState.reset();
    mockService = new S3MockWrapper();
  });

  describe('Factory Function', () => {
    it('should return singleton instance', () => {
      const instance1 = getMockS3Service();
      const instance2 = getMockS3Service();
      expect(instance1).toBe(instance2);
    });

    it('should return S3MockWrapper instance', () => {
      const instance = getMockS3Service();
      expect(instance).toBeInstanceOf(S3MockWrapper);
    });
  });

  describe('Presigned URL Generation', () => {
    it('should generate presigned upload URL', async () => {
      const key = 'test/upload.txt';
      const contentType = 'text/plain';

      const url = await mockService.generatePresignedUploadUrl(key, contentType);

      expect(url).toContain('/api/mock/s3/upload');
      expect(url).toContain(`key=${encodeURIComponent(key)}`);
      expect(url).toContain(`contentType=${encodeURIComponent(contentType)}`);
    });

    it('should generate presigned upload URL with custom expiration', async () => {
      const key = 'test/upload.txt';
      const contentType = 'text/plain';
      const expiresIn = 600;

      const url = await mockService.generatePresignedUploadUrl(key, contentType, expiresIn);

      // Mock doesn't actually enforce expiration, but URL should be generated
      expect(url).toContain('/api/mock/s3/upload');
    });

    it('should generate presigned download URL', async () => {
      const key = 'test/download.txt';

      const url = await mockService.generatePresignedDownloadUrl(key);

      expect(url).toContain('/api/mock/s3/download');
      expect(url).toContain(encodeURIComponent(key));
    });

    it('should generate presigned download URL with custom expiration', async () => {
      const key = 'test/download.txt';
      const expiresIn = 7200;

      const url = await mockService.generatePresignedDownloadUrl(key, expiresIn);

      expect(url).toContain('/api/mock/s3/download');
    });

    it('should generate presigned download URL for specific bucket', async () => {
      const bucket = 'custom-bucket';
      const key = 'test/file.txt';

      const url = await mockService.generatePresignedDownloadUrlForBucket(bucket, key);

      // Mock ignores bucket parameter
      expect(url).toContain('/api/mock/s3/download');
      expect(url).toContain(encodeURIComponent(key));
    });
  });

  describe('File Operations', () => {
    it('should put object', async () => {
      const key = 'test/file.txt';
      const buffer = Buffer.from('test content');
      const contentType = 'text/plain';

      await mockService.putObject(key, buffer, contentType);

      expect(s3MockState.fileExists(key)).toBe(true);
      const file = s3MockState.getFile(key);
      expect(file.buffer).toEqual(buffer);
      expect(file.contentType).toBe(contentType);
    });

    it('should get object', async () => {
      const key = 'test/file.txt';
      const buffer = Buffer.from('test content');
      const contentType = 'text/plain';

      s3MockState.storeFile(key, buffer, contentType);

      const result = await mockService.getObject(key);

      expect(result).toEqual(buffer);
    });

    it('should get object that does not exist (auto-create)', async () => {
      const key = 'test/missing.png';

      const result = await mockService.getObject(key);

      expect(result).toBeInstanceOf(Buffer);
      expect(s3MockState.fileExists(key)).toBe(true);
    });

    it('should delete object', async () => {
      const key = 'test/file.txt';
      const buffer = Buffer.from('test content');

      s3MockState.storeFile(key, buffer, 'text/plain');
      expect(s3MockState.fileExists(key)).toBe(true);

      await mockService.deleteObject(key);

      expect(s3MockState.fileExists(key)).toBe(false);
    });

    it('should handle delete of non-existent object', async () => {
      // Should not throw
      await expect(mockService.deleteObject('non-existent.txt')).resolves.toBeUndefined();
    });
  });

  describe('File Validation', () => {
    describe('validateFileType', () => {
      it('should validate allowed image types', () => {
        expect(mockService.validateFileType('image/jpeg')).toBe(true);
        expect(mockService.validateFileType('image/jpg')).toBe(true);
        expect(mockService.validateFileType('image/png')).toBe(true);
        expect(mockService.validateFileType('image/gif')).toBe(true);
        expect(mockService.validateFileType('image/webp')).toBe(true);
      });

      it('should validate allowed video types', () => {
        expect(mockService.validateFileType('video/mp4')).toBe(true);
        expect(mockService.validateFileType('video/webm')).toBe(true);
        expect(mockService.validateFileType('video/quicktime')).toBe(true);
      });

      it('should reject unsupported types', () => {
        expect(mockService.validateFileType('image/svg+xml')).toBe(false);
        expect(mockService.validateFileType('application/pdf')).toBe(false);
        expect(mockService.validateFileType('text/plain')).toBe(false);
        expect(mockService.validateFileType('video/avi')).toBe(false);
      });
    });

    describe('validateFileSize', () => {
      it('should validate size under default limit (10MB)', () => {
        const size = 5 * 1024 * 1024; // 5MB
        expect(mockService.validateFileSize(size)).toBe(true);
      });

      it('should validate size exactly at default limit (10MB)', () => {
        const size = 10 * 1024 * 1024; // 10MB
        expect(mockService.validateFileSize(size)).toBe(true);
      });

      it('should reject size over default limit (10MB)', () => {
        const size = 11 * 1024 * 1024; // 11MB
        expect(mockService.validateFileSize(size)).toBe(false);
      });

      it('should validate size with custom limit', () => {
        const size = 500 * 1024; // 500KB
        const maxSize = 1024 * 1024; // 1MB
        expect(mockService.validateFileSize(size, maxSize)).toBe(true);
      });

      it('should reject size over custom limit', () => {
        const size = 2 * 1024 * 1024; // 2MB
        const maxSize = 1024 * 1024; // 1MB
        expect(mockService.validateFileSize(size, maxSize)).toBe(false);
      });

      it('should handle zero size', () => {
        expect(mockService.validateFileSize(0)).toBe(true);
      });
    });
  });

  describe('Path Generation', () => {
    describe('generateS3Path', () => {
      it('should generate hierarchical S3 path', () => {
        const workspaceId = 'workspace-123';
        const swarmId = 'swarm-456';
        const taskId = 'task-789';
        const filename = 'file.txt';

        const path = mockService.generateS3Path(workspaceId, swarmId, taskId, filename);

        expect(path).toContain('uploads/');
        expect(path).toContain(workspaceId);
        expect(path).toContain(swarmId);
        expect(path).toContain(taskId);
        expect(path).toContain('file.txt');
      });

      it('should sanitize filename with special characters', () => {
        const workspaceId = 'workspace-123';
        const swarmId = 'swarm-456';
        const taskId = 'task-789';
        const filename = 'my file!@#$.txt';

        const path = mockService.generateS3Path(workspaceId, swarmId, taskId, filename);

        expect(path).not.toContain('!');
        expect(path).not.toContain('@');
        expect(path).not.toContain('#');
        expect(path).not.toContain('$');
        expect(path).not.toContain(' ');
      });

      it('should include timestamp and random ID', () => {
        const workspaceId = 'workspace-123';
        const swarmId = 'swarm-456';
        const taskId = 'task-789';
        const filename = 'file.txt';

        const path1 = mockService.generateS3Path(workspaceId, swarmId, taskId, filename);
        const path2 = mockService.generateS3Path(workspaceId, swarmId, taskId, filename);

        // Paths should be different due to timestamp and random ID
        expect(path1).not.toBe(path2);
      });

      it('should handle filename with multiple dots', () => {
        const path = mockService.generateS3Path('w1', 's1', 't1', 'my.file.name.txt');

        // Only special characters are replaced, dots are preserved
        expect(path).toContain('my.file.name.txt');
      });
    });

    describe('generateWorkspaceLogoPath', () => {
      it('should generate workspace logo path', () => {
        const workspaceId = 'workspace-123';
        const filename = 'logo.png';

        const path = mockService.generateWorkspaceLogoPath(workspaceId, filename);

        expect(path).toContain('workspace-logos/');
        expect(path).toContain(workspaceId);
        expect(path).toMatch(/\.png$/);
      });

      it('should sanitize filename', () => {
        const workspaceId = 'workspace-123';
        const filename = 'my logo!@#$.png';

        const path = mockService.generateWorkspaceLogoPath(workspaceId, filename);

        expect(path).not.toContain('!');
        expect(path).not.toContain('@');
        expect(path).not.toContain('#');
        expect(path).not.toContain('$');
        expect(path).not.toContain(' ');
      });

      it('should include timestamp', async () => {
        const workspaceId = 'workspace-123';
        const filename = 'logo.png';

        const path1 = mockService.generateWorkspaceLogoPath(workspaceId, filename);
        // Small delay to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 2));
        const path2 = mockService.generateWorkspaceLogoPath(workspaceId, filename);

        // Paths should be different due to timestamp
        expect(path1).not.toBe(path2);
      });

      it('should extract correct extension', () => {
        const workspaceId = 'workspace-123';
        
        const pngPath = mockService.generateWorkspaceLogoPath(workspaceId, 'logo.png');
        const jpgPath = mockService.generateWorkspaceLogoPath(workspaceId, 'logo.jpg');

        expect(pngPath).toMatch(/\.png$/);
        expect(jpgPath).toMatch(/\.jpg$/);
      });

      it('should handle filename without extension', () => {
        const workspaceId = 'workspace-123';
        const filename = 'logo';

        const path = mockService.generateWorkspaceLogoPath(workspaceId, filename);

        expect(path).toMatch(/\.logo$/); // Uses last part as extension
      });
    });

    describe('generateVideoS3Path', () => {
      it('should generate video recording path', () => {
        const workspaceId = 'workspace-123';
        const swarmId = 'swarm-456';
        const taskId = 'task-789';

        const path = mockService.generateVideoS3Path(workspaceId, swarmId, taskId);

        expect(path).toContain('uploads/');
        expect(path).toContain(workspaceId);
        expect(path).toContain(swarmId);
        expect(path).toContain(taskId);
        expect(path).toContain('recording_');
        expect(path).toMatch(/\.webm$/);
      });

      it('should include timestamp and random ID', () => {
        const workspaceId = 'workspace-123';
        const swarmId = 'swarm-456';
        const taskId = 'task-789';

        const path1 = mockService.generateVideoS3Path(workspaceId, swarmId, taskId);
        const path2 = mockService.generateVideoS3Path(workspaceId, swarmId, taskId);

        // Paths should be different due to timestamp and random ID
        expect(path1).not.toBe(path2);
      });
    });
  });

  describe('Image Buffer Validation', () => {
    it('should validate JPEG magic numbers', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(mockService.validateImageBuffer(jpegBuffer, 'image/jpeg')).toBe(true);
      expect(mockService.validateImageBuffer(jpegBuffer, 'image/jpg')).toBe(true);
    });

    it('should validate PNG magic numbers', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(mockService.validateImageBuffer(pngBuffer, 'image/png')).toBe(true);
    });

    it('should validate GIF magic numbers', () => {
      const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(mockService.validateImageBuffer(gifBuffer, 'image/gif')).toBe(true);
    });

    it('should validate WebP magic numbers', () => {
      const webpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);
      expect(mockService.validateImageBuffer(webpBuffer, 'image/webp')).toBe(true);
    });

    it('should reject buffer with wrong magic numbers', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(mockService.validateImageBuffer(jpegBuffer, 'image/png')).toBe(false);
    });

    it('should reject buffer that is too short', () => {
      const shortBuffer = Buffer.from([0xff, 0xd8]);
      expect(mockService.validateImageBuffer(shortBuffer, 'image/jpeg')).toBe(false);
    });

    it('should reject unsupported MIME type', () => {
      const buffer = Buffer.from([0, 1, 2, 3, 4]);
      expect(mockService.validateImageBuffer(buffer, 'image/svg+xml')).toBe(false);
    });

    it('should handle empty buffer', () => {
      const emptyBuffer = Buffer.from([]);
      expect(mockService.validateImageBuffer(emptyBuffer, 'image/jpeg')).toBe(false);
    });
  });

  describe('Video Buffer Validation', () => {
    it('should validate WebM magic numbers', () => {
      const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00]);
      expect(mockService.validateVideoBuffer(webmBuffer, 'video/webm')).toBe(true);
    });

    it('should reject buffer with wrong magic numbers', () => {
      const wrongBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(mockService.validateVideoBuffer(wrongBuffer, 'video/webm')).toBe(false);
    });

    it('should reject buffer that is too short', () => {
      const shortBuffer = Buffer.from([0x1a, 0x45]);
      expect(mockService.validateVideoBuffer(shortBuffer, 'video/webm')).toBe(false);
    });

    it('should reject unsupported video type', () => {
      const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      expect(mockService.validateVideoBuffer(buffer, 'video/mp4')).toBe(false);
    });

    it('should handle empty buffer', () => {
      const emptyBuffer = Buffer.from([]);
      expect(mockService.validateVideoBuffer(emptyBuffer, 'video/webm')).toBe(false);
    });
  });

  describe('Integration with S3MockState', () => {
    it('should use S3MockState for file storage', async () => {
      const key = 'test/integration.txt';
      const buffer = Buffer.from('integration test');
      const contentType = 'text/plain';

      await mockService.putObject(key, buffer, contentType);

      // Verify via state manager
      expect(s3MockState.fileExists(key)).toBe(true);
      const file = s3MockState.getFile(key);
      expect(file.buffer).toEqual(buffer);
    });

    it('should retrieve files from S3MockState', async () => {
      const key = 'test/integration.txt';
      const buffer = Buffer.from('integration test');

      s3MockState.storeFile(key, buffer, 'text/plain');

      const result = await mockService.getObject(key);
      expect(result).toEqual(buffer);
    });

    it('should use S3MockState URL generation', async () => {
      const key = 'test/file.txt';
      const contentType = 'text/plain';

      const uploadUrl = await mockService.generatePresignedUploadUrl(key, contentType);
      const downloadUrl = await mockService.generatePresignedDownloadUrl(key);

      // Should match S3MockState URL patterns
      expect(uploadUrl).toContain('/api/mock/s3/upload');
      expect(downloadUrl).toContain('/api/mock/s3/download');
    });
  });
});
