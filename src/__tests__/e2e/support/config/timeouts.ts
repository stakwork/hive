/**
 * Centralized timeout configuration for E2E tests
 *
 * Use these constants instead of hardcoded timeout values to ensure:
 * - Consistency across all tests
 * - Easy adjustment for different environments (CI vs local)
 * - Clear semantic meaning for different operation types
 */

/**
 * Base timeout values (in milliseconds)
 */
export const TIMEOUTS = {
  // Quick operations - DOM element visibility, state checks
  QUICK: 3000,

  // Standard operations - form interactions, page loads, API calls
  STANDARD: 10000,

  // Navigation operations - page transitions, URL changes
  NAVIGATION: 15000,

  // Complex operations - workspace creation, large data processing
  COMPLEX: 30000,

  // Network operations - API calls that may be slow
  NETWORK: 5000,

  // Loading states - waiting for spinners, content to load
  LOADING: 20000,
} as const;

/**
 * Semantic timeout aliases for specific use cases
 */
export const TIMEOUT_FOR = {
  // Element visibility and basic interactions
  ELEMENT_VISIBLE: TIMEOUTS.QUICK,
  ELEMENT_HIDDEN: TIMEOUTS.QUICK,
  BUTTON_CLICKABLE: TIMEOUTS.QUICK,
  INPUT_READY: TIMEOUTS.STANDARD,

  // Page and navigation
  PAGE_LOAD: TIMEOUTS.STANDARD,
  URL_CHANGE: TIMEOUTS.NAVIGATION,
  PAGE_TITLE: TIMEOUTS.STANDARD,

  // Forms and data entry
  FORM_SUBMISSION: TIMEOUTS.STANDARD,
  MODAL_OPEN: TIMEOUTS.STANDARD,
  MODAL_CLOSE: TIMEOUTS.STANDARD,

  // Authentication and workspace
  SIGN_IN: TIMEOUTS.NAVIGATION,
  WORKSPACE_CREATION: TIMEOUTS.COMPLEX,
  WORKSPACE_SWITCH: TIMEOUTS.NAVIGATION,

  // Tasks and content
  TASK_CREATION: TIMEOUTS.STANDARD,
  TASK_LIST_LOAD: TIMEOUTS.LOADING,
  CONTENT_SAVE: TIMEOUTS.STANDARD,

  // Network and API
  API_RESPONSE: TIMEOUTS.NETWORK,
  GRAPH_LOAD: TIMEOUTS.LOADING,
  NETWORK_IDLE: TIMEOUTS.NETWORK,

  // Loading states
  LOADING_SPINNER: TIMEOUTS.LOADING,
  DATA_FETCH: TIMEOUTS.LOADING,

  // Complex operations
  WORKSPACE_DELETE: TIMEOUTS.COMPLEX,
  MEMBER_INVITE: TIMEOUTS.STANDARD,
  SETTINGS_UPDATE: TIMEOUTS.STANDARD,
} as const;

/**
 * Environment-specific timeout multipliers
 * Use these to adjust timeouts based on environment (CI is typically slower)
 */
const ENVIRONMENT_MULTIPLIERS = {
  local: 1.0,
  ci: 2.0,     // CI environments are often slower
  docker: 1.5, // Docker can add overhead
} as const;

/**
 * Get the current environment multiplier
 */
function getEnvironmentMultiplier(): number {
  const env = process.env.NODE_ENV;
  const isCI = process.env.CI === 'true';
  const isDocker = process.env.DOCKER === 'true';

  if (isCI) return ENVIRONMENT_MULTIPLIERS.ci;
  if (isDocker) return ENVIRONMENT_MULTIPLIERS.docker;
  return ENVIRONMENT_MULTIPLIERS.local;
}

/**
 * Apply environment-specific adjustments to timeout values
 */
export function getTimeout(baseTimeout: number): number {
  const multiplier = getEnvironmentMultiplier();
  return Math.round(baseTimeout * multiplier);
}

/**
 * Convenience function to get semantic timeouts with environment adjustment
 */
export function timeoutFor<T extends keyof typeof TIMEOUT_FOR>(operation: T): number {
  return getTimeout(TIMEOUT_FOR[operation]);
}

/**
 * Legacy support - common timeout values for gradual migration
 */
export const LEGACY_TIMEOUTS = {
  SHORT: getTimeout(TIMEOUTS.QUICK),
  MEDIUM: getTimeout(TIMEOUTS.STANDARD),
  LONG: getTimeout(TIMEOUTS.COMPLEX),
  NAVIGATION: getTimeout(TIMEOUTS.NAVIGATION),
} as const;

// Type exports for better TypeScript support
export type TimeoutOperation = keyof typeof TIMEOUT_FOR;
export type BaseTimeout = keyof typeof TIMEOUTS;