/**
 * S3 Mock State Manager
 * 
 * Provides in-memory file storage for mocking S3 operations during local development and testing.
 * Follows singleton pattern consistent with other mock state managers in the codebase.
 * 
 * Features:
 * - In-memory file storage with metadata
 * - Auto-create mock files on demand (prevents 404s)
 * - Generates mock presigned URLs pointing to local endpoints
 * - Reset capability for test isolation
 */

interface FileMetadata {
  buffer: Buffer;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export class S3MockState {
  private static instance: S3MockState;
  private files: Map<string, FileMetadata> = new Map();

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): S3MockState {
    if (!S3MockState.instance) {
      S3MockState.instance = new S3MockState();
    }
    return S3MockState.instance;
  }

  /**
   * Store a file in mock storage
   */
  storeFile(key: string, buffer: Buffer, contentType: string): void {
    this.files.set(key, {
      buffer,
      contentType,
      size: buffer.length,
      uploadedAt: new Date(),
    });
  }

  /**
   * Retrieve a file from mock storage
   * Auto-creates a mock file if it doesn't exist
   */
  getFile(key: string): FileMetadata {
    if (!this.files.has(key)) {
      // Auto-create mock file to prevent 404s
      this.ensureFileExists(key);
    }
    return this.files.get(key)!;
  }

  /**
   * Check if a file exists in storage
   */
  fileExists(key: string): boolean {
    return this.files.has(key);
  }

  /**
   * Delete a file from storage
   */
  deleteFile(key: string): boolean {
    return this.files.delete(key);
  }

  /**
   * Generate a mock presigned upload URL
   * Points to local mock endpoint
   */
  generateMockPresignedUploadUrl(key: string, contentType: string): string {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const encodedKey = encodeURIComponent(key);
    return `${baseUrl}/api/mock/s3/upload?key=${encodedKey}&contentType=${encodeURIComponent(contentType)}`;
  }

  /**
   * Generate a mock presigned download URL
   * Points to local mock endpoint
   */
  generateMockPresignedDownloadUrl(key: string): string {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const encodedKey = encodeURIComponent(key);
    return `${baseUrl}/api/mock/s3/download/${encodedKey}`;
  }

  /**
   * Reset all stored files (for test isolation)
   */
  reset(): void {
    this.files.clear();
  }

  /**
   * Get storage statistics
   */
  getStats(): { fileCount: number; totalSize: number } {
    let totalSize = 0;
    for (const file of this.files.values()) {
      totalSize += file.size;
    }
    return {
      fileCount: this.files.size,
      totalSize,
    };
  }

  /**
   * Auto-create a mock file if it doesn't exist
   * Prevents 404 errors during development
   */
  private ensureFileExists(key: string): void {
    // Determine file type from key extension or create a default
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(key);
    const isVideo = /\.(mp4|webm|mov)$/i.test(key);

    let buffer: Buffer;
    let contentType: string;

    if (isImage) {
      // 1x1 transparent PNG
      buffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      contentType = 'image/png';
    } else if (isVideo) {
      // Minimal valid WebM file (just header)
      buffer = Buffer.from([
        0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x1f, 0x42, 0x86, 0x81, 0x01,
      ]);
      contentType = 'video/webm';
    } else {
      // Empty file for other types
      buffer = Buffer.alloc(0);
      contentType = 'application/octet-stream';
    }

    this.storeFile(key, buffer, contentType);
  }
}

// Export singleton instance
export const s3MockState = S3MockState.getInstance();
