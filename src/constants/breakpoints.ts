/**
 * Responsive breakpoint constants aligned with Tailwind CSS
 *
 * Tailwind breakpoints:
 * - sm: 640px
 * - md: 768px
 * - lg: 1024px
 * - xl: 1280px
 * - 2xl: 1536px
 *
 * Our responsive categories:
 * - Mobile: 0-767px (< md)
 * - Tablet: 768px-1023px (md to < lg)
 * - Desktop: 1024px+ (>= lg)
 */

export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  XXL: 1536,
} as const;

/**
 * Media query strings for use with window.matchMedia or useMediaQuery hook
 */
export const MEDIA_QUERIES = {
  /** Mobile devices: 0-767px */
  MOBILE: `(max-width: ${BREAKPOINTS.MD - 1}px)`,

  /** Tablet devices: 768px-1023px */
  TABLET: `(min-width: ${BREAKPOINTS.MD}px) and (max-width: ${BREAKPOINTS.LG - 1}px)`,

  /** Desktop devices: 1024px and above */
  DESKTOP: `(min-width: ${BREAKPOINTS.LG}px)`,

  /** Small screens and above: 640px+ */
  SM_AND_UP: `(min-width: ${BREAKPOINTS.SM}px)`,

  /** Medium screens and above: 768px+ (tablet + desktop) */
  MD_AND_UP: `(min-width: ${BREAKPOINTS.MD}px)`,

  /** Large screens and above: 1024px+ */
  LG_AND_UP: `(min-width: ${BREAKPOINTS.LG}px)`,

  /** Extra large screens and above: 1280px+ */
  XL_AND_UP: `(min-width: ${BREAKPOINTS.XL}px)`,
} as const;

/**
 * Type for breakpoint names
 */
export type BreakpointName = keyof typeof BREAKPOINTS;

/**
 * Type for media query names
 */
export type MediaQueryName = keyof typeof MEDIA_QUERIES;
