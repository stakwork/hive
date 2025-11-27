// WebM magic numbers for file type validation
const WEBM_MAGIC_NUMBERS = [0x1a, 0x45, 0xdf, 0xa3];

// Video file size limits
const DEFAULT_MAX_VIDEO_SIZE_MB = 100;

/**
 * Validates if a buffer contains a valid WebM file by checking magic numbers
 * @param buffer - The buffer to validate
 * @returns true if buffer starts with WebM magic numbers, false otherwise
 */
export function validateWebMBuffer(buffer: Buffer): boolean {
  if (buffer.length < WEBM_MAGIC_NUMBERS.length) {
    return false;
  }

  for (let i = 0; i < WEBM_MAGIC_NUMBERS.length; i++) {
    if (buffer[i] !== WEBM_MAGIC_NUMBERS[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Validates if file size is within allowed limit
 * @param sizeBytes - File size in bytes
 * @param maxSizeMB - Optional maximum size in MB (defaults to 100MB)
 * @returns true if size is within limit, false otherwise
 */
export function validateVideoSize(sizeBytes: number, maxSizeMB?: number): boolean {
  const limit = (maxSizeMB || DEFAULT_MAX_VIDEO_SIZE_MB) * 1024 * 1024;
  return sizeBytes <= limit;
}

/**
 * Gets the maximum allowed video size from environment or default
 * @returns Maximum video size in MB
 */
export function getMaxVideoSizeMB(): number {
  const envValue = process.env.MAX_VIDEO_SIZE_MB;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_VIDEO_SIZE_MB;
}
