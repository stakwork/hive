/**
 * S3 Mock Wrapper Service
 * 
 * Provides a mock implementation of S3Service for local development and testing.
 * Mimics the real S3Service interface but routes operations to in-memory storage.
 * 
 * Used when USE_MOCKS=true is set in environment configuration.
 */

import { s3MockState } from './s3-state';

export class S3MockWrapper {
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly allowedImageTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];
  private readonly allowedVideoTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ];

  /**
   * Generate a mock presigned upload URL
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    _expiresIn: number = 300 // 5 minutes default
  ): Promise<string> {
    return s3MockState.generateMockPresignedUploadUrl(key, contentType);
  }

  /**
   * Generate a mock presigned download URL
   */
  async generatePresignedDownloadUrl(
    key: string,
    _expiresIn: number = 3600 // 1 hour default
  ): Promise<string> {
    return s3MockState.generateMockPresignedDownloadUrl(key);
  }

  /**
   * Generate a mock presigned download URL for a specific bucket
   */
  async generatePresignedDownloadUrlForBucket(
    bucket: string,
    key: string,
    _expiresIn: number = 3600 // 1 hour default
  ): Promise<string> {
    // In mock mode, we ignore the bucket parameter and use the same mock logic
    return s3MockState.generateMockPresignedDownloadUrl(key);
  }

  /**
   * Delete an object from mock S3 storage
   */
  async deleteObject(key: string): Promise<void> {
    s3MockState.deleteFile(key);
  }

  /**
   * Get an object from mock S3 storage
   */
  async getObject(key: string): Promise<Buffer> {
    const file = s3MockState.getFile(key);
    return file.buffer;
  }

  /**
   * Store an object in mock S3 storage
   */
  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    s3MockState.storeFile(key, buffer, contentType);
  }

  /**
   * Validate file type (same logic as real S3Service)
   */
  validateFileType(contentType: string): boolean {
    return (
      this.allowedImageTypes.includes(contentType) ||
      this.allowedVideoTypes.includes(contentType)
    );
  }

  /**
   * Validate file size (same logic as real S3Service)
   */
  validateFileSize(size: number, maxSize?: number): boolean {
    const limit = maxSize || this.maxFileSize;
    return size <= limit;
  }

  /**
   * Generate S3 path with workspace/swarm/task hierarchy
   */
  generateS3Path(
    workspaceId: string,
    swarmId: string,
    taskId: string,
    filename: string
  ): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `uploads/${workspaceId}/${swarmId}/${taskId}/${timestamp}_${randomId}_${sanitizedFilename}`;
  }

  /**
   * Generate workspace logo path
   */
  generateWorkspaceLogoPath(workspaceId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const extension = sanitizedFilename.split('.').pop() || 'jpg';

    return `workspace-logos/${workspaceId}/${timestamp}.${extension}`;
  }

  /**
   * Generate video recording path
   */
  generateVideoS3Path(
    workspaceId: string,
    swarmId: string,
    taskId: string
  ): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    return `uploads/${workspaceId}/${swarmId}/${taskId}/recording_${timestamp}_${randomId}.webm`;
  }

  /**
   * Validate image buffer by checking magic numbers
   */
  validateImageBuffer(
    buffer: Buffer,
    expectedType: string
  ): boolean {
    try {
      const IMAGE_MAGIC_NUMBERS: Record<string, number[]> = {
        'image/jpeg': [0xff, 0xd8, 0xff],
        'image/jpg': [0xff, 0xd8, 0xff],
        'image/png': [0x89, 0x50, 0x4e, 0x47],
        'image/gif': [0x47, 0x49, 0x46, 0x38],
        'image/webp': [0x52, 0x49, 0x46, 0x46],
      };

      const magicNumbers = IMAGE_MAGIC_NUMBERS[expectedType];

      if (!magicNumbers) {
        return false;
      }

      if (buffer.length < magicNumbers.length) {
        return false;
      }

      for (let i = 0; i < magicNumbers.length; i++) {
        if (buffer[i] !== magicNumbers[i]) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate video buffer by checking magic numbers
   */
  validateVideoBuffer(buffer: Buffer, expectedType: string): boolean {
    try {
      const VIDEO_MAGIC_NUMBERS: Record<string, number[]> = {
        'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
      };

      const magicNumbers = VIDEO_MAGIC_NUMBERS[expectedType];

      if (!magicNumbers) {
        return false;
      }

      if (buffer.length < magicNumbers.length) {
        return false;
      }

      for (let i = 0; i < magicNumbers.length; i++) {
        if (buffer[i] !== magicNumbers[i]) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}

// Export factory function for consistency
let mockS3Instance: S3MockWrapper | null = null;

export function getMockS3Service(): S3MockWrapper {
  if (!mockS3Instance) {
    mockS3Instance = new S3MockWrapper();
  }
  return mockS3Instance;
}
