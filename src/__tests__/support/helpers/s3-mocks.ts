import { vi } from 'vitest';

/**
 * Creates mock S3 service methods for testing file upload functionality
 */
export function createMockS3Service() {
  return {
    validateFileType: vi.fn(),
    validateFileSize: vi.fn(),
    generatePresignedUploadUrl: vi.fn(),
    generatePresignedDownloadUrl: vi.fn(),
  };
}

/**
 * Sets up S3 service mocks for successful image upload scenarios
 * @param mockS3Service - The mocked S3 service instance
 * @param options - Optional configuration for mock responses
 */
export function setupSuccessfulS3Mocks(
  mockS3Service: ReturnType<typeof createMockS3Service>,
  options?: {
    uploadUrl?: string;
    downloadUrl?: string;
  }
) {
  vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
  vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
  vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
    options?.uploadUrl || 'https://test-bucket.s3.us-east-1.amazonaws.com/upload-url'
  );
  vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
    options?.downloadUrl || 'https://test-bucket.s3.us-east-1.amazonaws.com/download-url'
  );
}

/**
 * Sets up S3 service mocks to reject file type validation
 * @param mockS3Service - The mocked S3 service instance
 */
export function setupFileTypeRejectionMocks(
  mockS3Service: ReturnType<typeof createMockS3Service>
) {
  vi.mocked(mockS3Service.validateFileType).mockReturnValue(false);
  vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
}

/**
 * Sets up S3 service mocks to reject file size validation
 * @param mockS3Service - The mocked S3 service instance
 */
export function setupFileSizeRejectionMocks(
  mockS3Service: ReturnType<typeof createMockS3Service>
) {
  vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
  vi.mocked(mockS3Service.validateFileSize).mockReturnValue(false);
}
