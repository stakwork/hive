import { logger } from "@/lib/logger";

/**
 * Rate Limiter Configuration
 */
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory rate limiter using sliding window algorithm.
 * 
 * WARNING: This is a simple in-memory implementation suitable for development
 * and single-instance deployments. For production with multiple instances,
 * use a distributed rate limiter like @upstash/ratelimit with Redis.
 */
export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.startCleanup();
  }

  /**
   * Check if a request should be rate limited
   * @param identifier - Unique identifier (typically IP address)
   * @returns { allowed: boolean, retryAfter?: number }
   */
  check(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = this.store.get(identifier);

    if (!entry || now > entry.resetTime) {
      // First request or window expired - allow and create new entry
      this.store.set(identifier, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return { allowed: true };
    }

    if (entry.count < this.config.maxRequests) {
      // Within limit - increment and allow
      entry.count++;
      return { allowed: true };
    }

    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    logger.authWarn(
      "Rate limit exceeded",
      "RATE_LIMIT_EXCEEDED",
      {
        identifier,
        attempts: entry.count,
        retryAfter,
      }
    );

    return { allowed: false, retryAfter };
  }

  /**
   * Reset rate limit for a specific identifier
   */
  reset(identifier: string): void {
    this.store.delete(identifier);
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [identifier, entry] of this.store.entries()) {
        if (now > entry.resetTime) {
          this.store.delete(identifier);
        }
      }
    }, 60000);
  }

  /**
   * Stop cleanup interval (for testing)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Default rate limiter for authentication endpoints
 * 10 requests per minute per IP
 */
export const authRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
});

/**
 * Extract client IP address from request headers
 * Prioritizes X-Forwarded-For (from proxies/load balancers) over direct connection IP
 */
export function getClientIp(headers: Headers): string {
  // Check X-Forwarded-For header (comma-separated list, first is original client)
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  // Check X-Real-IP header (set by some proxies)
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  // Fallback to connection remote address (not available in middleware)
  return "unknown";
}