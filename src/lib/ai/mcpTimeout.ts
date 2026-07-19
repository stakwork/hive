import { optionalEnvVars } from '@/config/env';

/**
 * Races an MCP async operation against a configurable timeout.
 * Throws an error named 'McpTimeoutError' on expiry so callers can
 * distinguish it from network/protocol errors.
 *
 * Cleanup guarantees:
 *  - clearTimeout fires in the finally block when fn() wins the race,
 *    preventing a dangling timer from keeping the event loop alive or
 *    misfiring in fake-timer tests.
 *  - operation.catch(() => {}) is attached before the race so that if the
 *    timeout wins and fn() later rejects in the background, no
 *    unhandled-rejection event is emitted.
 */
export async function withMcpTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = optionalEnvVars.MCP_CLIENT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = fn();
  // Suppress unhandled-rejection if timeout settles the race before fn() completes
  operation.catch(() => {});
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`MCP client timed out after ${timeoutMs}ms`), {
            name: 'McpTimeoutError',
          }),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export function isMcpTimeout(e: unknown): boolean {
  return e instanceof Error && e.name === 'McpTimeoutError';
}
