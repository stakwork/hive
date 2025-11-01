import { useMediaQuery } from './useMediaQuery';
import { MEDIA_QUERIES } from '@/constants/breakpoints';

export interface ResponsiveState {
  /** Mobile devices: 0-767px (< md breakpoint) */
  isMobile: boolean;

  /** Tablet devices: 768px-1023px (md to < lg breakpoint) */
  isTablet: boolean;

  /** Desktop devices: 1024px+ (>= lg breakpoint) */
  isDesktop: boolean;

  /** Medium screens and above: 768px+ (tablet + desktop) */
  isMdAndUp: boolean;

  /** Large screens and above: 1024px+ (desktop) */
  isLgAndUp: boolean;
}

/**
 * Comprehensive responsive hook for detecting current screen size
 *
 * Returns an object with boolean flags for different device types.
 * Use this when you need to check multiple breakpoints in a component.
 *
 * @example
 * ```tsx
 * const { isMobile, isDesktop } = useResponsive();
 *
 * if (isMobile) {
 *   return <MobileLayout />;
 * }
 * return <DesktopLayout />;
 * ```
 *
 * For simpler cases where you only need mobile detection,
 * use `useIsMobile()` instead for less verbosity.
 */
export function useResponsive(): ResponsiveState {
  const isMobile = useMediaQuery(MEDIA_QUERIES.MOBILE);
  const isTablet = useMediaQuery(MEDIA_QUERIES.TABLET);
  const isDesktop = useMediaQuery(MEDIA_QUERIES.DESKTOP);
  const isMdAndUp = useMediaQuery(MEDIA_QUERIES.MD_AND_UP);
  const isLgAndUp = useMediaQuery(MEDIA_QUERIES.LG_AND_UP);

  return {
    isMobile,
    isTablet,
    isDesktop,
    isMdAndUp,
    isLgAndUp,
  };
}
