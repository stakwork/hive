/**
 * S3 Mock Wrapper Service
 * 
 * Provides a mock implementation of S3Service for local development and testing.
 * Mimics the real S3Service interface but routes operations to in-memory storage.
 * 
 * Used when USE_MOCKS=true is set in environment configuration.
 */

import fs from "node:fs";
import path from "node:path";
import { s3MockState } from './s3-state';

/**
 * On-disk HTML fixtures. The in-memory mock map is process-local and
 * has no persistence, so a seed script cannot put bytes where the
 * Next server will find them. Instead, the first `fileExists` /
 * `getObject` for a deterministic `orgs/{orgId}/canvas/{filename}`
 * key hydrates from this directory when `{filename}` matches a
 * fixture file.
 */
const HTML_FIXTURE_DIR = path.join(process.cwd(), "src/lib/mock/fixtures/html");

const HTML_FIXTURE_BASENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;

function hydrateHtmlFixture(key: string): void {
  if (s3MockState.fileExists(key)) return;
  const parts = key.split("/");
  // Seeded keys are `orgs/{orgId}/canvas/{filename}`. Reject anything
  // else (including path-traversal basenames) so we never read outside
  // the fixture directory.
  if (parts.length !== 4 || parts[0] !== "orgs" || parts[2] !== "canvas") {
    return;
  }
  const basename = parts[3];
  if (!HTML_FIXTURE_BASENAME.test(basename)) return;
  const fixturePath = path.join(HTML_FIXTURE_DIR, basename);
  try {
    if (!fs.existsSync(fixturePath)) return;
    const buffer = fs.readFileSync(fixturePath);
    s3MockState.storeFile(key, buffer, "text/html; charset=utf-8");
  } catch {
    // Best-effort: a missing or unreadable fixture stays missing.
  }
}

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
  private readonly allowedAudioTypes = [
    'audio/wav',
  ];

  /**
   * Generate a mock presigned upload URL
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string
  ): Promise<string> {
    return s3MockState.generateMockPresignedUploadUrl(key, contentType);
  }

  /**
   * Generate a mock presigned download URL
   */
  async generatePresignedDownloadUrl(key: string): Promise<string> {
    return s3MockState.generateMockPresignedDownloadUrl(key);
  }

  /**
   * Generate a mock presigned download URL for a specific bucket
   */
  async generatePresignedDownloadUrlForBucket(
    bucket: string,
    key: string
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
    hydrateHtmlFixture(key);
    const file = s3MockState.getFile(key);
    return file.buffer;
  }

  /**
   * Check whether a key is already in mock storage. Unlike `getFile` /
   * `getObject`, this does NOT auto-create a missing object. HTML
   * fixture keys are an exception: a matching on-disk fixture is
   * hydrated into the map first so seeded HtmlPage rows resolve.
   */
  fileExists(key: string): boolean {
    hydrateHtmlFixture(key);
    return s3MockState.fileExists(key);
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
      this.allowedVideoTypes.includes(contentType) ||
      this.allowedAudioTypes.includes(contentType)
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

  generateCanvasUploadPath(workspaceId: string, filename: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    return `uploads/${workspaceId}/canvas/${timestamp}_${randomId}_${sanitized}`
  }

  generateLingoIconPath(workspaceId: string, filename: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    return `uploads/${workspaceId}/lingo-icons/${timestamp}_${randomId}_${sanitized}`
  }

  generateOrgUploadPath(orgId: string, filename: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    return `orgs/${orgId}/canvas/${timestamp}_${randomId}_${sanitized}`
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

  /**
   * Validate audio buffer by checking magic numbers
   */
  validateAudioBuffer(buffer: Buffer, expectedType: string): boolean {
    try {
      const AUDIO_MAGIC_NUMBERS: Record<string, number[]> = {
        'audio/wav': [0x52, 0x49, 0x46, 0x46], // RIFF
      };

      const magicNumbers = AUDIO_MAGIC_NUMBERS[expectedType];

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
   * Generate voice signature path
   */
  generateVoiceSignaturePath(userId: string): string {
    return `voice-signatures/${userId}/signature.wav`;
  }

  /**
   * Generate whiteboard image path
   */
  generateWhiteboardImagePath(
    workspaceId: string,
    whiteboardId: string,
    fileId: string,
    mimeType: string
  ): string {
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
    return `whiteboards/${workspaceId}/${whiteboardId}/${fileId}.${ext}`
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
