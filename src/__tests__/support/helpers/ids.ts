import { WORKSPACE_SLUG_PATTERNS } from "@/lib/constants";

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
 * Generate a unique workspace slug that satisfies the product's own slug
 * rules (`WORKSPACE_SLUG_PATTERNS`: 2-50 chars, alphanumeric at both ends).
 *
 * API integration tests echo a fixture's slug straight back through
 * `updateWorkspaceSchema`, so an over-long fixture slug makes the route
 * answer 400 instead of 200. `generateUniqueSlug("test-workspace")` ran 50 to
 * 52 characters against the 50-character cap, because
 * `Math.random().toString(36)` yields a variable-length tail — roughly 2% of
 * slugs went over, surfacing as a rare, unattributable PUT failure.
 *
 * Fixed-width by construction; throws rather than returning an invalid slug.
 */
export function generateUniqueWorkspaceSlug(prefix: string = "test-ws"): string {
  const stamp = Date.now().toString(36); // 8 chars until year 2059
  const rand = Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);
  const slug = `${prefix}-${stamp}-${rand}`;

  if (slug.length > WORKSPACE_SLUG_PATTERNS.MAX_LENGTH) {
    throw new Error(
      `Fixture slug '${slug}' is ${slug.length} chars, over the ` +
        `${WORKSPACE_SLUG_PATTERNS.MAX_LENGTH}-char workspace slug cap.`,
    );
  }
  return slug;
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