import { useMediaQuery } from "./useMediaQuery";
import { MEDIA_QUERIES } from "@/constants/breakpoints";

/**
 * Convenience hook for detecting mobile devices
 *
 * Returns true for screens 0-767px (below Tailwind's md: breakpoint)
 *
 * @example
 * ```tsx
 * const isMobile = useIsMobile();
 *
 * return (
 *   <div className={isMobile ? "p-4" : "p-8"}>
 *     {isMobile ? <MobileNav /> : <DesktopNav />}
 *   </div>
 * );
 * ```
 *
 * For more complex responsive logic, use `useResponsive()` instead.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MEDIA_QUERIES.MOBILE);
}
