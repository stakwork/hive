import { JanitorType, Priority } from "@prisma/client";
import { FlaskConical, Zap, Monitor, Shield, LucideIcon } from "lucide-react";

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

/**
 * Type representing the enabled fields in JanitorConfig
 * Update this when adding new janitor types to the database schema
 */
export interface JanitorConfigFields {
  unitTestsEnabled: boolean;
  integrationTestsEnabled: boolean;
  e2eTestsEnabled: boolean;
  securityReviewEnabled: boolean;
}

/**
 * Complete janitor type configuration
 */
export const JANITOR_CONFIG: Record<JanitorType, {
  name: string;
  description: string;
  icon: LucideIcon;
  enabledField: keyof JanitorConfigFields;
}> = {
  UNIT_TESTS: {
    name: "Unit Tests",
    description: "Identify missing unit tests.",
    icon: FlaskConical,
    enabledField: "unitTestsEnabled",
  },
  INTEGRATION_TESTS: {
    name: "Integration Tests", 
    description: "Identify missing integration tests.",
    icon: Zap,
    enabledField: "integrationTestsEnabled",
  },
  E2E_TESTS: {
    name: "E2E Tests",
    description: "Identify missing end-to-end tests.",
    icon: Monitor,
    enabledField: "e2eTestsEnabled",
  },
  SECURITY_REVIEW: {
    name: "Security Review",
    description: "Scan for security vulnerabilities and best practices.",
    icon: Shield,
    enabledField: "securityReviewEnabled",
  },
} as const;

/**
 * Get the database field name for a given janitor type
 */
export function getEnabledFieldName(janitorType: JanitorType): keyof JanitorConfigFields {
  return JANITOR_CONFIG[janitorType].enabledField;
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
  const config = JANITOR_CONFIG[janitorType];
  return {
    id: janitorType,
    name: config.name,
    icon: config.icon,
    description: config.description,
    configKey: config.enabledField,
  };
}

/**
 * Get all available janitor items for UI
 * Excludes E2E_TESTS from the list
 */
export function getAllJanitorItems() {
  return Object.values(JanitorType)
    .filter(type => type !== JanitorType.E2E_TESTS)
    .map(createJanitorItem);
}

/**
 * Create Prisma OR conditions for finding workspaces with any enabled janitors
 */
export function createEnabledJanitorWhereConditions() {
  return Object.values(JanitorType).map(janitorType => ({
    [JANITOR_CONFIG[janitorType].enabledField]: true
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
  return JANITOR_CONFIG[janitorType].icon;
}