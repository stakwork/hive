/**
 * Pod Management Constants
 *
 * These constants define hardcoded values shared between pod management utilities
 * and API routes to ensure consistency across the codebase.
 */

/**
 * Pod port constants
 * These ports are standardized across all pods in the pool
 */
export const POD_PORTS = {
  /** Control port for pod management operations (starting services, getting process list, etc.) */
  CONTROL: "15552",
  /** Fallback frontend port when process discovery fails */
  FRONTEND_FALLBACK: "3000",
} as const;

/**
 * Process name constants
 * These are the standardized process names that appear in the pod process list
 */
export const PROCESS_NAMES = {
  /** Frontend application process */
  FRONTEND: "frontend",
  /** Goose AI agent service process */
  GOOSE: "goose",
} as const;
