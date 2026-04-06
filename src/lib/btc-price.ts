import { optionalEnvVars } from '@/config/env';

export async function fetchBtcPriceUsd(): Promise<number> {
  const url = `${optionalEnvVars.MEMPOOL_BASE_URL}/api/v1/prices`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mempool.space returned ${res.status}`);
    const data = await res.json();
    const price = data?.USD;
    if (typeof price !== 'number' || price <= 0) {
      throw new Error('Invalid BTC price returned from mempool.space');
    }
    return price;
  } catch (err) {
    throw new Error(`BTC price fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
