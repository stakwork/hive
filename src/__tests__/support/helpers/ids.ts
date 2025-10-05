/**
 * Generate a unique ID using timestamp + random string
 * This prevents collisions during parallel test execution
 * @param prefix - Optional prefix for the ID
 * @returns Unique ID string
 */
export function generateUniqueId(prefix?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const uniqueId = `${timestamp}-${random}`;
  return prefix ? `${prefix}-${uniqueId}` : uniqueId;
}

/**
 * Generate a unique slug for workspace/entity testing
 * @param prefix - Optional prefix for the slug (default: "test")
 * @returns Unique slug string
 */
export function generateUniqueSlug(prefix: string = "test"): string {
  return `${prefix}-${generateUniqueId()}`;
}

/**
 * Generate a unique email address for user testing
 * @param prefix - Optional prefix for the email (default: "test")
 * @returns Unique email string
 */
export function generateUniqueEmail(prefix: string = "test"): string {
  return `${prefix}-${generateUniqueId()}@example.com`;
}

/**
 * Generate a unique username for testing
 * @param prefix - Optional prefix for the username (default: "user")
 * @returns Unique username string
 */
export function generateUniqueUsername(prefix: string = "user"): string {
  return `${prefix}-${generateUniqueId()}`;
}

/**
 * Generate a unique name for testing
 * @param prefix - Optional prefix for the name (default: "Test")
 * @returns Unique name string
 */
export function generateUniqueName(prefix: string = "Test"): string {
  return `${prefix} ${generateUniqueId()}`;
}

/**
 * Generate a unique integer ID for testing (useful for database fields requiring integers)
 * Generates a 32-bit safe integer that fits in PostgreSQL INT4 field
 * @param prefix - Optional numeric prefix (will be multiplied by 1e6 and added to timestamp)
 * @returns Unique integer ID that fits in INT4 (32-bit signed integer)
 */
export function generateUniqueIntId(prefix: number = 0): number {
  // Use only the last 6 digits of timestamp to keep numbers smaller
  const timestamp = Date.now() % 1000000; // Last 6 digits
  const random = Math.floor(Math.random() * 1000); // 0-999
  // Max value: 999 * 1e6 + 999999 + 999 = 999,999,999 + 999,999 + 999 = 1,000,999,997
  // This fits comfortably within INT4 max value: 2,147,483,647
  return prefix * 1000000 + timestamp + random;
}