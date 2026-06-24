// @vitest-environment jsdom
import { useState, useEffect } from "react";

/**
 * Module-level singleton — one fetch per process, dedupes concurrent callers.
 * Call `resetTimezoneCache()` after a successful PATCH to force a re-fetch.
 */
let _tzPromise: Promise<string> | null = null;

/**
 * Reset the module-level singleton so the next call to `useUserTimezone`
 * will re-fetch from `/api/user/preferences`. Call this after the user
 * successfully saves a new timezone via the settings UI.
 */
export function resetTimezoneCache(): void {
  _tzPromise = null;
}

/**
 * Hook that returns the current user's stored IANA timezone preference.
 *
 * - Defaults to `"UTC"` while loading or when unauthenticated.
 * - Only one network request is made per page load regardless of how
 *   many components call this hook (module-level singleton promise).
 */
export function useUserTimezone(): { timezone: string } {
  const [timezone, setTimezone] = useState<string>("UTC");

  useEffect(() => {
    if (!_tzPromise) {
      _tzPromise = fetch("/api/user/preferences")
        .then((r) => r.json())
        .then((d: { timezone?: string }) => d.timezone ?? "UTC")
        .catch(() => "UTC");
    }
    _tzPromise.then(setTimezone);
  }, []);

  return { timezone };
}
