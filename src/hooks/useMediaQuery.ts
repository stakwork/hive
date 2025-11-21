import { useState, useEffect } from "react";

/**
 * Generic hook for matching CSS media queries
 *
 * Listens to window.matchMedia and returns true when the query matches.
 * Automatically updates when the viewport size changes.
 *
 * @param query - CSS media query string (e.g., "(max-width: 768px)")
 * @returns true if the media query matches, false otherwise
 *
 * @example
 * ```tsx
 * const isWideScreen = useMediaQuery('(min-width: 1920px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 * ```
 *
 * Note: For common responsive breakpoints, use `useIsMobile()` or `useResponsive()` instead.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }

    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);

  return matches;
}
