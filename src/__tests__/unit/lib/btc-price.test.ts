import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBtcPriceUsd } from '@/lib/btc-price';

describe('fetchBtcPriceUsd', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the USD price on a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ USD: 65000, EUR: 60000 }),
      }),
    );

    const price = await fetchBtcPriceUsd();
    expect(price).toBe(65000);
  });

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const price = await fetchBtcPriceUsd();
    expect(price).toBeNull();
  });

  it('returns null when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const price = await fetchBtcPriceUsd();
    expect(price).toBeNull();
  });

  it('returns null when USD value is missing from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ EUR: 60000 }),
      }),
    );

    const price = await fetchBtcPriceUsd();
    expect(price).toBeNull();
  });

  it('returns null when USD value is zero or negative', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ USD: 0 }),
      }),
    );

    const price = await fetchBtcPriceUsd();
    expect(price).toBeNull();
  });
});
