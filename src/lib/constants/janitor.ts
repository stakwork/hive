import { JanitorType, Priority } from "@prisma/client";
import { FlaskConical, Zap, LucideIcon } from "lucide-react";

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
 * Janitor type display names
 */
export const JANITOR_TYPE_DISPLAY_NAMES: Record<JanitorType, string> = {
  UNIT_TESTS: "Unit Tests",
  INTEGRATION_TESTS: "Integration Tests",
} as const;

/**
 * Janitor type descriptions
 */
export const JANITOR_TYPE_DESCRIPTIONS: Record<JanitorType, string> = {
  UNIT_TESTS: "Identify missing unit tests.",
  INTEGRATION_TESTS: "Identify missing integration tests.",
} as const;

/**
 * Janitor type icons for UI components
 */
export const JANITOR_TYPE_ICONS: Record<JanitorType, LucideIcon> = {
  UNIT_TESTS: FlaskConical,
  INTEGRATION_TESTS: Zap,
} as const;

/**
 * Type representing the enabled fields in JanitorConfig
 * Update this when adding new janitor types to the database schema
 */
export interface JanitorConfigFields {
  unitTestsEnabled: boolean;
  integrationTestsEnabled: boolean;
}

/**
 * Central mapping between JanitorType enum values and database column names
 * This ensures consistency across the codebase when working with janitor configurations
 */
export const JANITOR_TYPE_TO_ENABLED_FIELD: Record<JanitorType, keyof JanitorConfigFields> = {
  UNIT_TESTS: "unitTestsEnabled",
  INTEGRATION_TESTS: "integrationTestsEnabled",
} as const;

/**
 * Get the database field name for a given janitor type
 */
export function getEnabledFieldName(janitorType: JanitorType): keyof JanitorConfigFields {
  return JANITOR_TYPE_TO_ENABLED_FIELD[janitorType];
}

/**
 * Check if a janitor type is enabled in a config object
 */
export function isJanitorEnabled(
  janitorConfig: JanitorConfigFields, 
  janitorType: JanitorType
): boolean {
  const fieldName = getEnabledFieldName(janitorType);
  return janitorConfig[fieldName];
}

/**
 * Get all enabled janitor types from a config object
 */
export function getEnabledJanitorTypes(janitorConfig: JanitorConfigFields): JanitorType[] {
  return Object.values(JanitorType).filter(type => 
    isJanitorEnabled(janitorConfig, type)
  );
}

/**
 * Create a complete janitor item configuration for UI components
 */
export function createJanitorItem(janitorType: JanitorType) {
  return {
    id: janitorType,
    name: JANITOR_TYPE_DISPLAY_NAMES[janitorType],
    icon: JANITOR_TYPE_ICONS[janitorType],
    description: JANITOR_TYPE_DESCRIPTIONS[janitorType],
    configKey: getEnabledFieldName(janitorType),
  };
}

/**
 * Get all available janitor items for UI
 */
export function getAllJanitorItems() {
  return Object.values(JanitorType).map(createJanitorItem);
}

/**
 * Create Prisma OR conditions for finding workspaces with any enabled janitors
 */
export function createEnabledJanitorWhereConditions() {
  return Object.values(JanitorType).map(janitorType => ({
    [getEnabledFieldName(janitorType)]: true
  }));
}

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

/**
 * Get priority badge configuration for UI components
 */
export function getPriorityConfig(priority: Priority) {
  return PRIORITY_CONFIG[priority];
}

/**
 * Get icon component for a janitor type
 */
export function getJanitorIcon(janitorType: JanitorType) {
  return JANITOR_TYPE_ICONS[janitorType];
}