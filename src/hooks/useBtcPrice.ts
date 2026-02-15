import { useState, useEffect, useCallback } from "react";

interface BtcPriceState {
  priceUsd: number | null;
  isLoading: boolean;
  error: string | null;
}

// Cache for BTC price with expiry
let priceCache: { price: number; timestamp: number } | null = null;
const CACHE_DURATION_MS = 60 * 1000; // 60 seconds

/**
 * Converts USD cents to satoshis
 * @param usdCents - Price in USD cents (e.g., 5000 = $50.00)
 * @param btcPriceUsd - Current BTC price in USD (e.g., 100000 = $100,000)
 * @returns Number of satoshis, or null if conversion not possible
 */
export function usdToSats(usdCents: number, btcPriceUsd: number | null): number | null {
  if (!btcPriceUsd || btcPriceUsd <= 0) return null;
  // Convert cents to dollars, then to BTC, then to sats
  const usdDollars = usdCents / 100;
  const btc = usdDollars / btcPriceUsd;
  const sats = Math.round(btc * 100_000_000);
  return sats;
}

/**
 * Converts satoshis to USD
 * @param sats - Number of satoshis
 * @param btcPriceUsd - Current BTC price in USD (e.g., 100000 = $100,000)
 * @returns USD amount as a number, or null if conversion not possible
 */
export function satsToUsd(sats: number, btcPriceUsd: number | null): number | null {
  if (!btcPriceUsd || btcPriceUsd <= 0) return null;
  // Convert sats to BTC, then to USD
  const btc = sats / 100_000_000;
  const usd = btc * btcPriceUsd;
  return usd;
}

/**
 * Formats USD amount with dollar sign and 2 decimal places
 * @param usd - USD amount as a number
 * @returns Formatted string (e.g., "$50.00")
 */
export function formatUsd(usd: number): string {
  return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats satoshis with thousands separators
 * @param sats - Number of satoshis
 * @returns Formatted string (e.g., "50,000")
 */
export function formatSats(sats: number): string {
  return sats.toLocaleString();
}

/**
 * Hook to fetch and cache BTC price from mempool.space API
 */
export function useBtcPrice(): BtcPriceState & { refetch: () => Promise<void> } {
  const [state, setState] = useState<BtcPriceState>({
    priceUsd: priceCache?.price ?? null,
    isLoading: !priceCache,
    error: null,
  });

  const fetchPrice = useCallback(async () => {
    // Check cache first
    if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION_MS) {
      setState({ priceUsd: priceCache.price, isLoading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch("https://mempool.space/api/v1/prices");
      if (!response.ok) {
        throw new Error(`Failed to fetch BTC price: ${response.statusText}`);
      }

      const data = await response.json();
      const price = data.USD;

      if (typeof price !== "number" || price <= 0) {
        throw new Error("Invalid price data received");
      }

      // Update cache
      priceCache = { price, timestamp: Date.now() };

      setState({ priceUsd: price, isLoading: false, error: null });
    } catch (err) {
      console.error("Error fetching BTC price:", err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch BTC price",
      }));
    }
  }, []);

  useEffect(() => {
    fetchPrice();
  }, [fetchPrice]);

  return { ...state, refetch: fetchPrice };
}
