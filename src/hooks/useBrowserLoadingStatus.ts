import { useState, useEffect, useRef } from "react";

/**
 * Hook to poll a URL and track its loading status.
 * Shows browser immediately on first success, but continues polling to detect failures.
 * After 15 consecutive successes, stops polling (service is stable).
 */
export function useBrowserLoadingStatus(url: string | undefined) {
  const [isUrlReady, setIsUrlReady] = useState<Record<string, boolean>>({});
  const consecutiveSuccessesRef = useRef<Record<string, number>>({});
  const urlCheckAttemptsRef = useRef<Record<string, number>>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!url) return;

    const maxAttempts = 60; // 60 attempts = 2 minutes max
    const pollInterval = 2000; // 2 seconds
    const REQUIRED_CONSECUTIVE_SUCCESSES = 15;

    // If we've already achieved 15 consecutive successes, stop polling
    if ((consecutiveSuccessesRef.current[url] || 0) >= REQUIRED_CONSECUTIVE_SUCCESSES) return;

    const checkUrl = async () => {
      try {
        await fetch(url, {
          method: 'HEAD',
          mode: 'no-cors', // Allow checking cross-origin URLs
        });

        // Success! Show the browser immediately and increment consecutive counter
        setIsUrlReady(prev => ({ ...prev, [url]: true }));
        consecutiveSuccessesRef.current[url] = (consecutiveSuccessesRef.current[url] || 0) + 1;

        // Stop polling after 15 consecutive successes
        if (consecutiveSuccessesRef.current[url] >= REQUIRED_CONSECUTIVE_SUCCESSES) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        // URL failed, reset consecutive successes and show spinner again
        consecutiveSuccessesRef.current[url] = 0;
        setIsUrlReady(prev => ({ ...prev, [url]: false }));

        // Increment total attempts
        urlCheckAttemptsRef.current[url] = (urlCheckAttemptsRef.current[url] || 0) + 1;

        if (urlCheckAttemptsRef.current[url] >= maxAttempts) {
          // Give up after max attempts and show iframe anyway
          setIsUrlReady(prev => ({ ...prev, [url]: true }));
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    };

    // Initial check
    checkUrl();

    // Set up polling
    intervalRef.current = setInterval(checkUrl, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [url]); // Only re-run when URL changes

  return {
    isReady: url ? isUrlReady[url] : false,
  };
}
