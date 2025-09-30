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