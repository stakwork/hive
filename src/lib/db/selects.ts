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

// Roadmap Task Select Constants
// Base task fields without relations (for minimal queries)
export const TASK_BASE_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  order: true,
  featureId: true,
  phaseId: true,
  bountyCode: true,
  stakworkProjectId: true,
  dependsOnTaskIds: true,
  systemAssigneeType: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Task with minimal relations (for list views, phase nested tasks)
export const TASK_LIST_SELECT = {
  ...TASK_BASE_SELECT,
  assignee: {
    select: USER_SELECT,
  },
  phase: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
} as const;

// Task with full relations (for detail views, single task queries)
export const TASK_DETAIL_SELECT = {
  ...TASK_BASE_SELECT,
  assignee: {
    select: USER_SELECT,
  },
  phase: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  feature: {
    select: {
      id: true,
      title: true,
      workspaceId: true,
    },
  },
  createdBy: {
    select: USER_SELECT,
  },
  updatedBy: {
    select: USER_SELECT,
  },
} as const;
