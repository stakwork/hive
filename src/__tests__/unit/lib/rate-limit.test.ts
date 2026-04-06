import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  },
}));

import { redis } from '@/lib/redis';
import { getClientIp, checkRateLimit } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';

const mockIncr = vi.mocked(redis.incr);
const mockExpire = vi.mocked(redis.expire);
const mockTtl = vi.mocked(redis.ttl);

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe('getClientIp', () => {
  test('returns first IP from x-forwarded-for', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  test('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = makeRequest({ 'x-real-ip': '9.10.11.12' });
    expect(getClientIp(req)).toBe('9.10.11.12');
  });

  test('returns "unknown" when no IP headers are present', () => {
    const req = makeRequest();
    expect(getClientIp(req)).toBe('unknown');
  });

  test('trims whitespace from x-forwarded-for first entry', () => {
    const req = makeRequest({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpire.mockResolvedValue(1 as any);
    mockTtl.mockResolvedValue(45);
  });

  test('allows request when count is under the limit', async () => {
    mockIncr.mockResolvedValue(1);

    const result = await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  test('sets EXPIRE only on first increment (count === 1)', async () => {
    mockIncr.mockResolvedValue(1);

    await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(mockExpire).toHaveBeenCalledOnce();
    expect(mockExpire).toHaveBeenCalledWith('rl:test:1.2.3.4', 60);
  });

  test('does not call EXPIRE when count > 1', async () => {
    mockIncr.mockResolvedValue(5);

    await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(mockExpire).not.toHaveBeenCalled();
  });

  test('allows request at exactly the limit', async () => {
    mockIncr.mockResolvedValue(10);

    const result = await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(result.allowed).toBe(true);
  });

  test('rejects request when count exceeds the limit', async () => {
    mockIncr.mockResolvedValue(11);
    mockTtl.mockResolvedValue(30);

    const result = await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(30);
  });

  test('uses windowSecs as retryAfter when TTL is -1 (key has no expiry)', async () => {
    mockIncr.mockResolvedValue(11);
    mockTtl.mockResolvedValue(-1);

    const result = await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });

  test('uses windowSecs as retryAfter when TTL returns 0', async () => {
    mockIncr.mockResolvedValue(11);
    mockTtl.mockResolvedValue(0);

    const result = await checkRateLimit('rl:test:1.2.3.4', 10, 60);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });

  test('calls INCR with the provided key', async () => {
    mockIncr.mockResolvedValue(3);

    await checkRateLimit('rl:stripe-checkout:192.168.1.1', 10, 60);

    expect(mockIncr).toHaveBeenCalledWith('rl:stripe-checkout:192.168.1.1');
  });
});
