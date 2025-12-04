import { describe, it, expect, beforeEach } from 'vitest';
import { S3MockState, s3MockState } from '@/lib/mock/s3-state';

describe('S3MockState', () => {
  beforeEach(() => {
    // Reset state before each test for isolation
    s3MockState.reset();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = S3MockState.getInstance();
      const instance2 = S3MockState.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should export a singleton instance', () => {
      expect(s3MockState).toBeInstanceOf(S3MockState);
    });
  });

  describe('File Storage Operations', () => {
    it('should store a file', () => {
      const key = 'test/file.txt';
      const buffer = Buffer.from('test content');
      const contentType = 'text/plain';

      s3MockState.storeFile(key, buffer, contentType);

      expect(s3MockState.fileExists(key)).toBe(true);
    });

    it('should retrieve a stored file', () => {
      const key = 'test/image.png';
      const buffer = Buffer.from('image data');
      const contentType = 'image/png';

      s3MockState.storeFile(key, buffer, contentType);
      const file = s3MockState.getFile(key);

      expect(file.buffer).toEqual(buffer);
      expect(file.contentType).toBe(contentType);
      expect(file.size).toBe(buffer.length);
      expect(file.uploadedAt).toBeInstanceOf(Date);
    });

    it('should auto-create a mock file if it does not exist', () => {
      const key = 'test/missing.png';

      // File doesn't exist yet
      expect(s3MockState.fileExists(key)).toBe(false);

      // Getting the file auto-creates it
      const file = s3MockState.getFile(key);

      expect(s3MockState.fileExists(key)).toBe(true);
      expect(file.buffer).toBeInstanceOf(Buffer);
      expect(file.contentType).toBe('image/png');
    });

    it('should delete a file', () => {
      const key = 'test/delete-me.txt';
      const buffer = Buffer.from('delete this');
      const contentType = 'text/plain';

      s3MockState.storeFile(key, buffer, contentType);
      expect(s3MockState.fileExists(key)).toBe(true);

      const deleted = s3MockState.deleteFile(key);

      expect(deleted).toBe(true);
      expect(s3MockState.fileExists(key)).toBe(false);
    });

    it('should return false when deleting a non-existent file', () => {
      const deleted = s3MockState.deleteFile('non-existent.txt');
      expect(deleted).toBe(false);
    });

    it('should overwrite an existing file', () => {
      const key = 'test/overwrite.txt';
      const buffer1 = Buffer.from('original content');
      const buffer2 = Buffer.from('new content');

      s3MockState.storeFile(key, buffer1, 'text/plain');
      s3MockState.storeFile(key, buffer2, 'text/plain');

      const file = s3MockState.getFile(key);
      expect(file.buffer).toEqual(buffer2);
    });
  });

  describe('Auto-creation of Mock Files', () => {
    it('should auto-create a PNG file with correct magic numbers', () => {
      const key = 'test/auto.png';
      const file = s3MockState.getFile(key);

      expect(file.contentType).toBe('image/png');
      expect(file.buffer.length).toBeGreaterThan(0);
      // PNG magic numbers: 89 50 4E 47
      expect(file.buffer[0]).toBe(0x89);
      expect(file.buffer[1]).toBe(0x50);
      expect(file.buffer[2]).toBe(0x4e);
      expect(file.buffer[3]).toBe(0x47);
    });

    it('should auto-create a JPEG file when extension is jpg', () => {
      const key = 'test/auto.jpg';
      const file = s3MockState.getFile(key);

      expect(file.contentType).toBe('image/png'); // Default image type
      expect(file.buffer.length).toBeGreaterThan(0);
    });

    it('should auto-create a WebM video file', () => {
      const key = 'test/recording.webm';
      const file = s3MockState.getFile(key);

      expect(file.contentType).toBe('video/webm');
      expect(file.buffer.length).toBeGreaterThan(0);
      // WebM magic numbers: 1A 45 DF A3
      expect(file.buffer[0]).toBe(0x1a);
      expect(file.buffer[1]).toBe(0x45);
      expect(file.buffer[2]).toBe(0xdf);
      expect(file.buffer[3]).toBe(0xa3);
    });

    it('should auto-create an empty file for unknown types', () => {
      const key = 'test/unknown.xyz';
      const file = s3MockState.getFile(key);

      expect(file.contentType).toBe('application/octet-stream');
      expect(file.buffer.length).toBe(0);
    });

    it('should handle various image extensions', () => {
      const extensions = ['jpeg', 'gif', 'webp'];
      
      extensions.forEach(ext => {
        const key = `test/auto.${ext}`;
        const file = s3MockState.getFile(key);
        expect(file.contentType).toBe('image/png');
      });
    });

    it('should handle various video extensions', () => {
      const extensions = ['mp4', 'mov'];
      
      extensions.forEach(ext => {
        const key = `test/recording.${ext}`;
        const file = s3MockState.getFile(key);
        expect(file.contentType).toBe('video/webm');
      });
    });
  });

  describe('Presigned URL Generation', () => {
    it('should generate a mock presigned upload URL', () => {
      const key = 'test/upload.txt';
      const contentType = 'text/plain';

      const url = s3MockState.generateMockPresignedUploadUrl(key, contentType);

      expect(url).toContain('/api/mock/s3/upload');
      expect(url).toContain(`key=${encodeURIComponent(key)}`);
      expect(url).toContain(`contentType=${encodeURIComponent(contentType)}`);
    });

    it('should generate a mock presigned download URL', () => {
      const key = 'test/download.txt';

      const url = s3MockState.generateMockPresignedDownloadUrl(key);

      expect(url).toContain('/api/mock/s3/download');
      expect(url).toContain(encodeURIComponent(key));
    });

    it('should use NEXTAUTH_URL as base URL if available', () => {
      const originalUrl = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = 'https://custom-domain.com';

      const key = 'test/file.txt';
      const url = s3MockState.generateMockPresignedUploadUrl(key, 'text/plain');

      expect(url.startsWith('https://custom-domain.com')).toBe(true);

      // Restore original value
      if (originalUrl) {
        process.env.NEXTAUTH_URL = originalUrl;
      } else {
        delete process.env.NEXTAUTH_URL;
      }
    });

    it('should handle keys with special characters', () => {
      const key = 'uploads/workspace-id/file name with spaces.txt';
      const url = s3MockState.generateMockPresignedUploadUrl(key, 'text/plain');

      expect(url).toContain(encodeURIComponent(key));
    });

    it('should handle keys with slashes', () => {
      const key = 'uploads/workspace/swarm/task/file.txt';
      const url = s3MockState.generateMockPresignedDownloadUrl(key);

      // The key should be URL-encoded as a whole
      expect(url).toContain(encodeURIComponent(key));
    });
  });

  describe('Storage Statistics', () => {
    it('should return empty stats for empty storage', () => {
      const stats = s3MockState.getStats();

      expect(stats.fileCount).toBe(0);
      expect(stats.totalSize).toBe(0);
    });

    it('should return correct file count', () => {
      s3MockState.storeFile('file1.txt', Buffer.from('content1'), 'text/plain');
      s3MockState.storeFile('file2.txt', Buffer.from('content2'), 'text/plain');
      s3MockState.storeFile('file3.txt', Buffer.from('content3'), 'text/plain');

      const stats = s3MockState.getStats();

      expect(stats.fileCount).toBe(3);
    });

    it('should return correct total size', () => {
      const buffer1 = Buffer.from('short');
      const buffer2 = Buffer.from('a bit longer content');

      s3MockState.storeFile('file1.txt', buffer1, 'text/plain');
      s3MockState.storeFile('file2.txt', buffer2, 'text/plain');

      const stats = s3MockState.getStats();

      expect(stats.totalSize).toBe(buffer1.length + buffer2.length);
    });

    it('should update stats when files are added and removed', () => {
      const buffer = Buffer.from('test content');

      s3MockState.storeFile('file1.txt', buffer, 'text/plain');
      s3MockState.storeFile('file2.txt', buffer, 'text/plain');

      let stats = s3MockState.getStats();
      expect(stats.fileCount).toBe(2);
      expect(stats.totalSize).toBe(buffer.length * 2);

      s3MockState.deleteFile('file1.txt');

      stats = s3MockState.getStats();
      expect(stats.fileCount).toBe(1);
      expect(stats.totalSize).toBe(buffer.length);
    });
  });

  describe('Reset Functionality', () => {
    it('should clear all files', () => {
      s3MockState.storeFile('file1.txt', Buffer.from('content1'), 'text/plain');
      s3MockState.storeFile('file2.txt', Buffer.from('content2'), 'text/plain');

      expect(s3MockState.getStats().fileCount).toBe(2);

      s3MockState.reset();

      expect(s3MockState.getStats().fileCount).toBe(0);
      expect(s3MockState.fileExists('file1.txt')).toBe(false);
      expect(s3MockState.fileExists('file2.txt')).toBe(false);
    });

    it('should allow storing files after reset', () => {
      s3MockState.storeFile('file1.txt', Buffer.from('content1'), 'text/plain');
      s3MockState.reset();

      s3MockState.storeFile('file2.txt', Buffer.from('content2'), 'text/plain');

      expect(s3MockState.fileExists('file2.txt')).toBe(true);
      expect(s3MockState.getStats().fileCount).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty buffer', () => {
      const key = 'empty.txt';
      const buffer = Buffer.alloc(0);

      s3MockState.storeFile(key, buffer, 'text/plain');
      const file = s3MockState.getFile(key);

      expect(file.buffer.length).toBe(0);
      expect(file.size).toBe(0);
    });

    it('should handle large buffer', () => {
      const key = 'large.bin';
      const buffer = Buffer.alloc(10 * 1024 * 1024); // 10MB

      s3MockState.storeFile(key, buffer, 'application/octet-stream');
      const file = s3MockState.getFile(key);

      expect(file.size).toBe(10 * 1024 * 1024);
    });

    it('should handle keys with only slashes', () => {
      const key = '///';
      const buffer = Buffer.from('content');

      s3MockState.storeFile(key, buffer, 'text/plain');

      expect(s3MockState.fileExists(key)).toBe(true);
    });

    it('should handle keys with leading and trailing slashes', () => {
      const key = '/path/to/file.txt/';
      const buffer = Buffer.from('content');

      s3MockState.storeFile(key, buffer, 'text/plain');
      const file = s3MockState.getFile(key);

      expect(file.buffer).toEqual(buffer);
    });

    it('should handle contentType with charset', () => {
      const key = 'file.txt';
      const buffer = Buffer.from('content');
      const contentType = 'text/plain; charset=utf-8';

      s3MockState.storeFile(key, buffer, contentType);
      const file = s3MockState.getFile(key);

      expect(file.contentType).toBe(contentType);
    });

    it('should preserve uploaded timestamp', () => {
      const key = 'file.txt';
      const buffer = Buffer.from('content');
      const beforeTime = new Date();

      s3MockState.storeFile(key, buffer, 'text/plain');
      
      const afterTime = new Date();
      const file = s3MockState.getFile(key);

      expect(file.uploadedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(file.uploadedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
