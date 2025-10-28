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
  /** Goose web service port - AI agent service always runs on this port */
  GOOSE: "15551",
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

/**
 * Goose service configuration
 * Controls the behavior of Goose service startup and polling
 */
export const GOOSE_CONFIG = {
  /** Maximum number of attempts to poll for Goose service availability after startup */
  MAX_STARTUP_ATTEMPTS: 10,
  /** Time (in milliseconds) to wait between polling attempts */
  POLLING_INTERVAL_MS: 1000,
} as const;

/**
 * Frontend service configuration
 * Controls the behavior of frontend service startup and polling
 */
export const FRONTEND_CONFIG = {
  /** Maximum number of attempts to poll for frontend service availability after startup */
  MAX_STARTUP_ATTEMPTS: 30,
  /** Time (in milliseconds) to wait between polling attempts */
  POLLING_INTERVAL_MS: 1000,
} as const;
