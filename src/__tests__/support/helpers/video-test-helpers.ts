/**
 * Video test helpers for integration tests
 * Generates valid WebM video buffers and timestamps data for recording endpoint tests
 */

/**
 * WebM magic numbers for file format validation
 * Reference: https://en.wikipedia.org/wiki/WebM
 */
const WEBM_MAGIC_NUMBERS = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * Generates a minimal valid WebM video buffer for testing
 * Contains WebM magic numbers followed by minimal EBML header
 * 
 * @param sizeInBytes - Desired buffer size (default: 1024 bytes / 1KB)
 * @returns Buffer with valid WebM format
 */
export function generateValidWebMBuffer(sizeInBytes: number = 1024): Buffer {
  const buffer = Buffer.alloc(sizeInBytes);
  
  // Write WebM magic numbers at start
  WEBM_MAGIC_NUMBERS.forEach((byte, index) => {
    buffer[index] = byte;
  });
  
  // Write minimal EBML header structure
  // Element ID for EBML: 0x1A 0x45 0xDF 0xA3
  // Size: variable (we'll use a simple placeholder)
  buffer[4] = 0x01; // Minimal size field
  buffer[5] = 0xFF; // Data placeholder
  
  // Fill rest with zeros (valid padding in WebM)
  buffer.fill(0, 6);
  
  return buffer;
}

/**
 * Generates an invalid video buffer (not WebM format)
 * Used for testing file validation failures
 * 
 * @returns Buffer without WebM magic numbers
 */
export function generateInvalidVideoBuffer(): Buffer {
  const buffer = Buffer.alloc(1024);
  // Fill with non-WebM data (JPEG magic numbers as example)
  buffer[0] = 0xFF;
  buffer[1] = 0xD8;
  buffer[2] = 0xFF;
  buffer[3] = 0xE0;
  return buffer;
}

/**
 * Generates a large video buffer exceeding size limits
 * Used for testing file size validation
 * 
 * @param sizeMB - Size in megabytes (default: 110MB to exceed typical 100MB limit)
 * @returns Buffer with valid WebM format but excessive size
 */
export function generateOversizedVideoBuffer(sizeMB: number = 110): Buffer {
  const sizeInBytes = sizeMB * 1024 * 1024;
  return generateValidWebMBuffer(sizeInBytes);
}

/**
 * Generates test timestamps data for Playwright recordings
 * Format matches expected structure from Playwright execution
 * 
 * @returns Array of timestamp objects with action metadata
 */
export function generateTestTimestamps() {
  return [
    {
      timestamp: Date.now(),
      action: "navigate",
      url: "https://example.com",
      selector: null,
      value: null,
    },
    {
      timestamp: Date.now() + 1000,
      action: "click",
      url: "https://example.com",
      selector: "button[data-testid='submit']",
      value: null,
    },
    {
      timestamp: Date.now() + 2000,
      action: "fill",
      url: "https://example.com/form",
      selector: "input[name='email']",
      value: "test@example.com",
    },
  ];
}

/**
 * Generates invalid JSON string for testing parse errors
 * 
 * @returns Malformed JSON string
 */
export function generateInvalidTimestampsJSON(): string {
  return "{invalid json structure without quotes";
}