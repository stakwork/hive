import { WorkspaceRole, JanitorType, Priority } from "@prisma/client";

/**
 * Janitor system error messages
 */
export const JANITOR_ERRORS = {
  CONFIG_NOT_FOUND: "Janitor configuration not found",
  RUN_NOT_FOUND: "Janitor run not found",
  RUN_IN_PROGRESS: "A janitor run of this type is already in progress",
  JANITOR_DISABLED: "This janitor type is not enabled",
  RECOMMENDATION_NOT_FOUND: "Recommendation not found",
  RECOMMENDATION_ALREADY_PROCESSED: "Recommendation has already been processed",
  ASSIGNEE_NOT_MEMBER: "Assignee is not a member of this workspace",
  REPOSITORY_NOT_FOUND: "Repository not found in this workspace",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions to perform this action",
  WORKSPACE_NOT_FOUND: "Workspace not found or access denied",
} as const;

// Janitor permission levels removed - using standard workspace permissions instead

/**
 * Default pagination limits
 */
export const JANITOR_PAGINATION = {
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

/**
 * Janitor type display names
 */
export const JANITOR_TYPE_DISPLAY_NAMES: Record<JanitorType, string> = {
  UNIT_TESTS: "Unit Tests",
  INTEGRATION_TESTS: "Integration Tests",
} as const;

/**
 * Priority configuration for display and sorting
 */
export const PRIORITY_CONFIG: Record<Priority, {
  label: string;
  color: string;
  weight: number;
}> = {
  LOW: {
    label: "Low",
    color: "gray",
    weight: 1,
  },
  MEDIUM: {
    label: "Medium", 
    color: "blue",
    weight: 2,
  },
  HIGH: {
    label: "High",
    color: "orange", 
    weight: 3,
  },
  CRITICAL: {
    label: "Critical",
    color: "red",
    weight: 4,
  },
} as const;