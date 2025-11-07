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
    if (!url) {
      console.log('[useBrowserLoadingStatus] No URL provided');
      return;
    }

    console.log('[useBrowserLoadingStatus] Starting polling for:', url);

    const maxAttempts = 60; // 60 attempts = 2 minutes max
    const pollInterval = 2000; // 2 seconds
    const REQUIRED_CONSECUTIVE_SUCCESSES = 15;

    // If we've already achieved 15 consecutive successes, stop polling
    if ((consecutiveSuccessesRef.current[url] || 0) >= REQUIRED_CONSECUTIVE_SUCCESSES) {
      console.log('[useBrowserLoadingStatus] Already achieved 15 consecutive successes, not polling');
      return;
    }

    // Initialize as not ready when we start polling
    setIsUrlReady(prev => ({ ...prev, [url]: false }));

    const checkUrl = async () => {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          cache: 'no-cache',
        });

        console.log('[useBrowserLoadingStatus] Response status:', response.status, 'ok:', response.ok);

        // Check if response is not an error (accept 2xx and 3xx, reject 4xx and 5xx)
        if (response.status >= 400) {
          console.log('[useBrowserLoadingStatus] Got error response:', response.status);
          throw new Error(`HTTP ${response.status}`);
        }

        const newCount = (consecutiveSuccessesRef.current[url] || 0) + 1;
        console.log('[useBrowserLoadingStatus] Success! Consecutive:', newCount);

        // Success! Show the browser immediately and increment consecutive counter
        setIsUrlReady(prev => ({ ...prev, [url]: true }));
        consecutiveSuccessesRef.current[url] = newCount;

        // Stop polling after 15 consecutive successes
        if (consecutiveSuccessesRef.current[url] >= REQUIRED_CONSECUTIVE_SUCCESSES) {
          console.log('[useBrowserLoadingStatus] Reached 15 consecutive successes, stopping polling');
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (error) {
        console.log('[useBrowserLoadingStatus] Failed!', error);
        // URL failed, reset consecutive successes and show spinner again
        consecutiveSuccessesRef.current[url] = 0;
        setIsUrlReady(prev => ({ ...prev, [url]: false }));

        // Increment total attempts
        urlCheckAttemptsRef.current[url] = (urlCheckAttemptsRef.current[url] || 0) + 1;
        const attempts = urlCheckAttemptsRef.current[url];
        console.log('[useBrowserLoadingStatus] Total attempts:', attempts);

        if (attempts >= maxAttempts) {
          console.log('[useBrowserLoadingStatus] Max attempts reached, giving up');
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
      console.log('[useBrowserLoadingStatus] Cleanup');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [url]); // Only re-run when URL changes

  const ready = url ? (isUrlReady[url] ?? false) : false;
  console.log('[useBrowserLoadingStatus] Returning isReady:', ready, 'for url:', url);

  return {
    isReady: ready,
  };
}
