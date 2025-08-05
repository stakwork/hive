import {
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS,
  WORKSPACE_ERRORS,
} from "@/lib/constants";

/**
 * Validates a workspace slug against reserved words and format requirements
 */
export function validateWorkspaceSlug(slug: string): {
  isValid: boolean;
  error?: string;
} {
  // Check length
  if (
    slug.length < WORKSPACE_SLUG_PATTERNS.MIN_LENGTH ||
    slug.length > WORKSPACE_SLUG_PATTERNS.MAX_LENGTH
  ) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH };
  }

  // Check format (lowercase alphanumeric with hyphens, start/end with alphanumeric)
  if (!WORKSPACE_SLUG_PATTERNS.VALID.test(slug)) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT };
  }

  // Check against reserved slugs
  if (
    RESERVED_WORKSPACE_SLUGS.includes(
      slug as (typeof RESERVED_WORKSPACE_SLUGS)[number],
    )
  ) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_RESERVED };
  }

  return { isValid: true };
}

