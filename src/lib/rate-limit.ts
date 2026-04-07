import { redis } from '@/lib/redis';
import type { NextRequest } from 'next/server';

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSecs);
  }
  if (count > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSecs };
  }
  return { allowed: true };
}
