/**
 * Utility functions for janitor system
 * Note: Most validation and permission logic has been moved to dedicated helper files
 */

import { JanitorType, Priority } from "@prisma/client";
import {
  JANITOR_TYPE_DISPLAY_NAMES,
  PRIORITY_CONFIG,
} from "@/lib/constants/janitor";

/**
 * Map priority string to Priority enum with fallback
 */
export function mapPriorityFromString(priority: string): Priority {
  const priorityUpper = priority.toUpperCase();
  
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priorityUpper)) {
    return priorityUpper as Priority;
  }
  
  return "MEDIUM";
}

/**
 * Get display name for janitor type
 */
export function getJanitorTypeDisplayName(type: JanitorType): string {
  return JANITOR_TYPE_DISPLAY_NAMES[type] || type;
}

/**
 * Get priority configuration (label, color, weight)
 */
export function getPriorityConfig(priority: Priority) {
  return PRIORITY_CONFIG[priority];
}

/**
 * Sort recommendations by priority (highest first)
 */
export function sortByPriority<T extends { priority: Priority }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const aWeight = PRIORITY_CONFIG[a.priority].weight;
    const bWeight = PRIORITY_CONFIG[b.priority].weight;
    return bWeight - aWeight;
  });
}

/**
 * Check if a janitor run is in progress
 */
export function isJanitorRunInProgress(status: string): boolean {
  return ["PENDING", "RUNNING"].includes(status.toUpperCase());
}

/**
 * Check if a janitor run is completed (success or failure)
 */
export function isJanitorRunCompleted(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED"].includes(status.toUpperCase());
}