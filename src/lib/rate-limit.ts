import { Ratelimit, Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  webhook: {
    requests: parseInt(process.env.RATE_LIMIT_WEBHOOK_REQUESTS || "100", 10),
    window: (process.env.RATE_LIMIT_WEBHOOK_WINDOW || "1 m") as Duration,
  },
  api: {
    requests: parseInt(process.env.RATE_LIMIT_API_REQUESTS || "1000", 10),
    window: (process.env.RATE_LIMIT_API_WINDOW || "1 m") as Duration,
  },
};

// Initialize Redis client (only if Redis URL is provided)
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Create rate limiter instances
const webhookRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_CONFIG.webhook.requests,
        RATE_LIMIT_CONFIG.webhook.window
      ),
      analytics: true,
      prefix: "@ratelimit/webhook",
    })
  : null;

const apiRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_CONFIG.api.requests,
        RATE_LIMIT_CONFIG.api.window
      ),
      analytics: true,
      prefix: "@ratelimit/api",
    })
  : null;

export type RateLimitType = "webhook" | "api";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending?: Promise<unknown>;
}

/**
 * Extract identifier for rate limiting from request
 * Priority: IP address > x-forwarded-for > x-real-ip > fallback
 */
export function extractRateLimitIdentifier(request: Request): string {
  // Try to get IP from various headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can be comma-separated, take the first IP
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback to a generic identifier if no IP is available
  // This should rarely happen in production environments
  return "unknown-ip";
}

/**
 * Check rate limit for a given request
 * @param identifier - Unique identifier for rate limiting (usually IP address)
 * @param type - Type of rate limit to apply (webhook or api)
 * @returns Rate limit result with success status and metadata
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType = "webhook"
): Promise<RateLimitResult> {
  const limiter = type === "webhook" ? webhookRateLimiter : apiRateLimiter;
  const config = RATE_LIMIT_CONFIG[type];

  // If Redis is not configured, allow request but log warning
  if (!limiter) {
    console.warn(
      `[Rate Limit] Redis not configured - rate limiting disabled for ${type} (identifier: ${identifier})`
    );
    return {
      success: true,
      limit: config.requests,
      remaining: config.requests,
      reset: Date.now() + 60000, // 1 minute from now
    };
  }

  try {
    // Check rate limit
    const result = await limiter.limit(identifier);

    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
      pending: result.pending,
    };
  } catch (error) {
    // Log error but allow request to proceed
    console.error(`[Rate Limit] Error checking rate limit:`, error);
    return {
      success: true,
      limit: config.requests,
      remaining: config.requests,
      reset: Date.now() + 60000,
    };
  }
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(
  result: RateLimitResult
): Record<string, string> {
  return {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": new Date(result.reset).toISOString(),
  };
}

/**
 * Create 429 Too Many Requests response
 */
export function createRateLimitResponse(
  result: RateLimitResult
): Response {
  const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
  
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": retryAfter.toString(),
        ...createRateLimitHeaders(result),
      },
    }
  );
}
