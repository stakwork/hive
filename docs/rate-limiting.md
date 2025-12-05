# Rate Limiting

This document describes the rate limiting implementation for the Hive Platform API endpoints.

## Overview

Rate limiting is implemented at the middleware level to protect all webhook and API endpoints from abuse, brute-force attacks, and denial-of-service scenarios. The implementation uses [Upstash Redis](https://upstash.com/) with a sliding window algorithm for accurate rate limiting.

## Architecture

### Components

1. **Rate Limit Utility** (`src/lib/rate-limit.ts`)
   - Core rate limiting logic
   - Redis client initialization
   - Sliding window rate limiter
   - Helper functions for headers and responses

2. **Middleware Integration** (`src/middleware.ts`)
   - Applies rate limiting before authentication
   - Returns 429 responses when limit exceeded
   - Adds rate limit headers to all responses

3. **Configuration** (`src/config/middleware.ts`)
   - Route-based rate limit policies
   - Environment-based configuration

## Configuration

### Environment Variables

```bash
# Redis connection (required for production)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here

# Webhook rate limits (default: 100 requests per minute)
RATE_LIMIT_WEBHOOK_REQUESTS=100
RATE_LIMIT_WEBHOOK_WINDOW="1 m"

# API rate limits (default: 1000 requests per minute)
RATE_LIMIT_API_REQUESTS=1000
RATE_LIMIT_API_WINDOW="1 m"
```

### Rate Limit Types

| Type | Default Limit | Window | Applied To |
|------|--------------|--------|------------|
| `webhook` | 100 requests | 1 minute | All webhook endpoints (`/api/*/webhook`) |
| `api` | 1000 requests | 1 minute | General API routes (future use) |

### Supported Time Windows

The `window` parameter accepts various formats:
- `"1 s"` - 1 second
- `"10 s"` - 10 seconds
- `"1 m"` - 1 minute
- `"5 m"` - 5 minutes
- `"1 h"` - 1 hour

## Protected Endpoints

### Webhook Endpoints (Rate Limited)

All webhook endpoints receive rate limiting protection:

- `/api/graph/webhook` - Graph service webhooks
- `/api/github/webhook` - GitHub webhooks
- `/api/github/app/webhook` - GitHub App webhooks
- `/api/swarm/stakgraph/webhook` - Stakgraph webhooks
- `/api/stakwork/webhook` - Stakwork webhooks
- `/api/janitors/webhook` - Janitor webhooks
- `/api/chat/response` - Chat response webhooks
- `/api/tasks/*/title` - Task title update webhooks
- `/api/tasks/*/recording` - Task recording webhooks

## Rate Limit Behavior

### Successful Requests

When a request is within the rate limit:
- Request proceeds normally
- Response includes rate limit headers:
  ```
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 95
  X-RateLimit-Reset: 2024-01-15T10:30:00.000Z
  ```

### Exceeded Rate Limit

When a request exceeds the rate limit:
- Returns HTTP 429 (Too Many Requests)
- Includes `Retry-After` header (seconds until reset)
- Response body:
  ```json
  {
    "error": "Too Many Requests",
    "message": "Rate limit exceeded. Please try again later.",
    "retryAfter": 45
  }
  ```

### Rate Limit Headers

All responses include rate limit information:

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Maximum requests allowed | `100` |
| `X-RateLimit-Remaining` | Requests remaining in window | `95` |
| `X-RateLimit-Reset` | ISO timestamp when limit resets | `2024-01-15T10:30:00.000Z` |
| `Retry-After` | Seconds until rate limit resets (429 only) | `45` |

## Development

### Local Development

For local development without Redis:
- Rate limiting is **disabled** when Redis is not configured
- Requests proceed normally with warning logs
- Mock rate limit values are returned

### Testing

Rate limiting can be tested in multiple ways:

1. **Unit Tests**: Mock rate limiting behavior
   ```typescript
   vi.mock("@/lib/rate-limit", () => ({
     checkRateLimit: vi.fn(() => ({
       success: false,
       limit: 100,
       remaining: 0,
       reset: Date.now() + 60000,
     })),
   }));
   ```

2. **Integration Tests**: Test with actual endpoint
   ```bash
   npm run test:integration
   ```

3. **Manual Testing**: Use curl to test rate limits
   ```bash
   # Make multiple requests quickly
   for i in {1..110}; do
     curl -X POST http://localhost:3000/api/graph/webhook \
       -H "Content-Type: application/json" \
       -H "x-api-key: your-key" \
       -d '{"node_ids": ["test"]}'
   done
   ```

## Rate Limit Identifier

Requests are rate limited based on IP address, extracted in order of priority:

1. `x-forwarded-for` header (first IP in comma-separated list)
2. `x-real-ip` header
3. Fallback: `"unknown-ip"` (rare in production)

## Sliding Window Algorithm

The implementation uses a sliding window algorithm which:
- Provides smooth rate limiting without burst allowances
- Prevents edge-case gaming (e.g., timing requests at window boundaries)
- More accurate than fixed window counters
- Recommended by Upstash for production use

## Production Considerations

### Redis Setup

1. Create an Upstash Redis database at https://upstash.com/
2. Choose a region close to your deployment
3. Copy REST URL and token to environment variables
4. Enable TLS for production

### Monitoring

Monitor rate limiting metrics:
- **429 response rate**: Track how often clients hit limits
- **Redis latency**: Ensure rate limit checks are fast (<10ms)
- **False positives**: Monitor for legitimate users being blocked
- **Distributed attacks**: Watch for many IPs hitting limits

### Adjusting Limits

Adjust rate limits based on:
- **Traffic patterns**: Analyze typical request rates
- **Attack patterns**: Respond to ongoing attacks
- **Legitimate use**: Don't block normal API consumers
- **Endpoint sensitivity**: Different limits for different endpoints

### Alerts

Set up alerts for:
- High 429 response rates (>10% of requests)
- Redis connection failures
- Unusual traffic spikes
- Specific IPs hitting limits repeatedly

## Troubleshooting

### Rate Limiting Not Working

1. Check Redis connection:
   ```bash
   # Verify environment variables are set
   echo $UPSTASH_REDIS_REST_URL
   echo $UPSTASH_REDIS_REST_TOKEN
   ```

2. Check logs for rate limit warnings:
   ```
   [Rate Limit] Redis not configured - rate limiting disabled
   ```

3. Verify endpoint is configured for rate limiting:
   - Check `src/config/middleware.ts` route policies
   - Ensure route has `access: "webhook"`

### Legitimate Users Being Blocked

1. Increase rate limits in environment variables
2. Implement API key-based rate limiting (future enhancement)
3. Whitelist specific IPs (requires custom logic)

### Redis Performance Issues

1. Check Redis region matches deployment region
2. Monitor Redis metrics in Upstash dashboard
3. Consider upgrading Redis plan for higher throughput

## Future Enhancements

Potential improvements to rate limiting:

- **Per-API-key rate limiting**: Different limits for different clients
- **Tiered rate limits**: Higher limits for authenticated users
- **Dynamic rate limiting**: Adjust limits based on system load
- **IP allowlisting**: Bypass rate limits for trusted sources
- **Geographic rate limiting**: Different limits by region
- **Endpoint-specific limits**: Granular control per endpoint

## References

- [Upstash Ratelimit Documentation](https://upstash.com/docs/redis/features/ratelimiting)
- [Sliding Window Algorithm](https://en.wikipedia.org/wiki/Sliding_window_protocol)
- [HTTP 429 Status Code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)