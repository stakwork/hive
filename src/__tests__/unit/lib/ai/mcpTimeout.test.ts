import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withMcpTimeout, isMcpTimeout } from '@/lib/ai/mcpTimeout';

vi.mock('@/config/env', async () => {
  const actual = await vi.importActual<typeof import('@/config/env')>('@/config/env');
  return {
    ...actual,
    optionalEnvVars: {
      ...((actual as any).optionalEnvVars ?? {}),
      MCP_CLIENT_TIMEOUT_MS: 30000,
    },
  };
});

describe('withMcpTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the resolved value when fn() completes before timeout', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const p = withMcpTimeout(fn, 1000);
    // fn resolves immediately (microtask), so we just await
    const result = await p;
    expect(result).toBe('success');
  });

  it('does not fire a dangling timeout rejection after fn() wins', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = withMcpTimeout(fn, 1000);
    const result = await p;
    expect(result).toBe('ok');

    // Advance past the timeout — should not cause any unhandled rejection
    await vi.runAllTimersAsync();
    // No assertions to make here beyond not throwing
  });

  it('rejects with McpTimeoutError when fn() never resolves and timer fires', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const p = withMcpTimeout(fn, 5000);

    // Attach rejection handler BEFORE advancing timers to prevent unhandledRejection detection
    const assertion = expect(p).rejects.toMatchObject({
      name: 'McpTimeoutError',
      message: 'MCP client timed out after 5000ms',
    });

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('isMcpTimeout returns true for McpTimeoutError', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));
    const p = withMcpTimeout(fn, 5000);

    // Attach rejection handler BEFORE advancing timers to prevent unhandledRejection detection
    let caught: unknown;
    const catcher = p.catch(e => { caught = e; });

    await vi.advanceTimersByTimeAsync(5000);
    await catcher;

    expect(isMcpTimeout(caught)).toBe(true);
  });

  it('propagates fn() rejection unchanged when fn() rejects before timeout', async () => {
    const originalError = new Error('network failure');
    const fn = vi.fn().mockRejectedValue(originalError);

    const p = withMcpTimeout(fn, 5000);

    await expect(p).rejects.toThrow('network failure');
  });

  it('isMcpTimeout returns false for a regular error', () => {
    const err = new Error('something else');
    expect(isMcpTimeout(err)).toBe(false);
  });

  it('isMcpTimeout returns false for non-Error values', () => {
    expect(isMcpTimeout('string')).toBe(false);
    expect(isMcpTimeout(null)).toBe(false);
    expect(isMcpTimeout(42)).toBe(false);
  });
});
