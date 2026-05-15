import { randomBytes } from "crypto";
import { redis } from "@/lib/redis";

/**
 * Distributed mutex using Redis `SET NX PX`.
 *
 * Acquires a lock keyed by `key`, runs `fn`, and releases the lock. If the
 * lock is held by another caller, retries (with small jitter) until either
 * the lock is acquired or `options.acquireTimeoutMs` elapses.
 *
 * Release is safe across crashes/timeouts because:
 *   - Each acquisition uses a random token; release only deletes the key if
 *     the stored token still matches (Lua compare-and-delete).
 *   - The lock expires automatically after `options.ttlMs` even if the
 *     holder crashes.
 *
 * If `fn` runs longer than `ttlMs`, the lock will silently expire and
 * another caller can enter — pick `ttlMs` >> expected `fn` duration.
 */

const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface WithLockOptions {
  /** Lock TTL in milliseconds. Default: 30_000. */
  ttlMs?: number;
  /** Maximum time to wait to acquire the lock. Default: 10_000. */
  acquireTimeoutMs?: number;
  /** Base retry interval in milliseconds. Default: 100. */
  retryIntervalMs?: number;
}

export class LockAcquireTimeoutError extends Error {
  constructor(key: string, waitedMs: number) {
    super(`Timed out acquiring lock '${key}' after ${waitedMs}ms`);
    this.name = "LockAcquireTimeoutError";
  }
}

/**
 * Acquire a redis lock, run `fn`, and release. Throws
 * `LockAcquireTimeoutError` if the lock can't be acquired within
 * `acquireTimeoutMs`. Re-throws any error from `fn` after releasing.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: WithLockOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 30_000;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
  const retryIntervalMs = options.retryIntervalMs ?? 100;

  const token = randomBytes(16).toString("hex");
  const start = Date.now();

  while (true) {
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    if (result === "OK") break;

    const elapsed = Date.now() - start;
    if (elapsed >= acquireTimeoutMs) {
      throw new LockAcquireTimeoutError(key, elapsed);
    }

    // Small jitter to reduce thundering herd on contention.
    const jitter = Math.floor(Math.random() * retryIntervalMs);
    await new Promise((r) => setTimeout(r, retryIntervalMs + jitter));
  }

  try {
    return await fn();
  } finally {
    try {
      // Compare-and-delete so we never release a lock whose ownership
      // already expired and was taken over by someone else.
      await redis.eval(RELEASE_LUA, 1, key, token);
    } catch (err) {
      // Release errors must not mask the result of `fn`.
      console.error("[withLock] release failed", { key, err });
    }
  }
}
