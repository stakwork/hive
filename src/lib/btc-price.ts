export async function fetchBtcPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://mempool.space/api/v1/prices');
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.USD;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  }
}
