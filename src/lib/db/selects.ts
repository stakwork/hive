/**
 * Common Prisma select objects used across the application
 *
 * These constants provide reusable select configurations for Prisma queries,
 * ensuring consistency and reducing duplication across services.
 */

/**
 * Standard user fields select
 * Used for assignees, creators, updaters, and other user references
 */
export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;
