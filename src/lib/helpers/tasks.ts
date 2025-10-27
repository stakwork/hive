/**
 * Task sanitization helpers
 *
 * These functions remove sensitive fields from task objects before
 * sending them to the frontend, preventing credential leaks.
 */

/**
 * Remove sensitive agent credentials from a task object
 *
 * @param task - Task object potentially containing sensitive fields
 * @returns Sanitized task without agentPassword and agentUrl
 */
export function sanitizeTask<T extends { agentPassword?: string | null; agentUrl?: string | null }>(
  task: T
): Omit<T, 'agentPassword' | 'agentUrl'> {
  const { agentPassword, agentUrl, ...sanitized } = task;
  return sanitized;
}

/**
 * Remove sensitive agent credentials from an array of task objects
 *
 * @param tasks - Array of task objects
 * @returns Array of sanitized tasks
 */
export function sanitizeTasks<T extends { agentPassword?: string | null; agentUrl?: string | null }>(
  tasks: T[]
): Omit<T, 'agentPassword' | 'agentUrl'>[] {
  return tasks.map(sanitizeTask);
}
