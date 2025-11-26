import type { SystemContext } from '@/types/janitor';

/**
 * Creates a validated system context for internal operations.
 * Only call this from endpoints that have verified their authority (e.g., CRON_SECRET validation).
 */
export function createSystemContext(
  source: SystemContext['source'],
  operationId?: string
): SystemContext {
  return {
    source,
    timestamp: new Date(),
    operationId,
  };
}

/**
 * Validates that a system context is legitimate and recent.
 * @param context - The system context to validate
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns true if valid, false otherwise
 */
export function validateSystemContext(
  context: SystemContext | undefined,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  if (!context) {
    return false;
  }

  // Verify required fields
  if (!context.source || !context.timestamp) {
    return false;
  }

  // Verify context is not too old (prevents replay attacks)
  const age = Date.now() - context.timestamp.getTime();
  if (age > maxAgeMs) {
    return false;
  }

  // Verify source is from an allowed system
  const allowedSources: SystemContext['source'][] = ['CRON_SERVICE', 'INTERNAL_SYSTEM'];
  if (!allowedSources.includes(context.source)) {
    return false;
  }

  return true;
}

/**
 * Error messages for system context validation failures.
 */
export const SYSTEM_CONTEXT_ERRORS = {
  INVALID_CONTEXT: 'Invalid or expired system context',
  MISSING_CONTEXT: 'System context required for scheduled operations',
  UNAUTHORIZED_SOURCE: 'Unauthorized system context source',
} as const;