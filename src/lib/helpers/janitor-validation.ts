import { JanitorType, JanitorStatus, RecommendationStatus, Priority } from "@prisma/client";

/**
 * Type guards for janitor system using Prisma enums
 */
export function isValidJanitorType(type: string): type is JanitorType {
  const values = Object.values(JanitorType) as string[];
  return values.includes(type.toUpperCase());
}

export function isValidJanitorStatus(status: string): status is JanitorStatus {
  const values = Object.values(JanitorStatus) as string[];
  return values.includes(status.toUpperCase());
}

export function isValidRecommendationStatus(status: string): status is RecommendationStatus {
  const values = Object.values(RecommendationStatus) as string[];
  return values.includes(status.toUpperCase());
}

export function isValidPriority(priority: string): priority is Priority {
  const values = Object.values(Priority) as string[];
  return values.includes(priority.toUpperCase());
}

/**
 * Convert string to proper enum types with validation
 */
export function parseJanitorType(type: string): JanitorType {
  const upperType = type.toUpperCase();
  if (!isValidJanitorType(upperType)) {
    throw new Error(`Invalid janitor type: ${type}`);
  }
  return upperType as JanitorType;
}

export function parseJanitorStatus(status: string): JanitorStatus {
  const upperStatus = status.toUpperCase();
  if (!isValidJanitorStatus(upperStatus)) {
    throw new Error(`Invalid janitor status: ${status}`);
  }
  return upperStatus as JanitorStatus;
}

export function parseRecommendationStatus(status: string): RecommendationStatus {
  const upperStatus = status.toUpperCase();
  if (!isValidRecommendationStatus(upperStatus)) {
    throw new Error(`Invalid recommendation status: ${status}`);
  }
  return upperStatus as RecommendationStatus;
}

export function parsePriority(priority: string): Priority {
  const upperPriority = priority.toUpperCase();
  if (!isValidPriority(upperPriority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }
  return upperPriority as Priority;
}

/**
 * Validation for pagination parameters
 */
export function validatePaginationParams(limit?: string | number | null, page?: string | number | null) {
  const parsedLimit = typeof limit === "string" ? parseInt(limit, 10) : limit || 10;
  const parsedPage = typeof page === "string" ? parseInt(page, 10) : page || 1;

  const validatedLimit = Math.min(Math.max(parsedLimit, 1), 100);
  const validatedPage = Math.max(parsedPage, 1);

  return {
    limit: validatedLimit,
    page: validatedPage,
    skip: (validatedPage - 1) * validatedLimit,
  };
}

/**
 * Format janitor types and statuses for display
 */
export function formatJanitorTypeForDisplay(type: JanitorType): string {
  return type.toLowerCase().replace(/_/g, " ");
}

export function formatJanitorStatusForDisplay(status: JanitorStatus): string {
  return status.toLowerCase();
}

export function formatRecommendationStatusForDisplay(status: RecommendationStatus): string {
  return status.toLowerCase();
}

/**
 * Check if janitor type is enabled on config
 */
export function getEnabledFieldForJanitorType(janitorType: JanitorType): keyof {
  unitTestsEnabled: boolean;
  integrationTestsEnabled: boolean;
} {
  switch (janitorType) {
    case "UNIT_TESTS":
      return "unitTestsEnabled";
    case "INTEGRATION_TESTS":
      return "integrationTestsEnabled";
    default:
      throw new Error(`Unsupported janitor type: ${janitorType}`);
  }
}