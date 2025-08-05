import {
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS,
  WORKSPACE_ERRORS,
} from "@/lib/constants";
import { SlugValidationResult } from "@/types/workspace";

/**
 * Validates a workspace slug against reserved words and format requirements
 */
export function validateWorkspaceSlug(slug: string): SlugValidationResult {
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

/**
 * Validates workspace name
 */
export function validateWorkspaceName(name: string): SlugValidationResult {
  if (!name || name.trim().length === 0) {
    return { isValid: false, error: "Workspace name is required" };
  }

  if (name.length < 2) {
    return { isValid: false, error: "Workspace name must be at least 2 characters" };
  }

  if (name.length > 100) {
    return { isValid: false, error: "Workspace name must be less than 100 characters" };
  }

  return { isValid: true };
}

/**
 * Validates workspace description
 */
export function validateWorkspaceDescription(description?: string): SlugValidationResult {
  if (!description) {
    return { isValid: true }; // Description is optional
  }

  if (description.length > 500) {
    return { isValid: false, error: "Workspace description must be less than 500 characters" };
  }

  return { isValid: true };
}

/**
 * Validates complete workspace data
 */
export function validateWorkspaceData(data: {
  name: string;
  slug: string;
  description?: string;
}): SlugValidationResult {
  const nameValidation = validateWorkspaceName(data.name);
  if (!nameValidation.isValid) {
    return nameValidation;
  }

  const slugValidation = validateWorkspaceSlug(data.slug);
  if (!slugValidation.isValid) {
    return slugValidation;
  }

  const descriptionValidation = validateWorkspaceDescription(data.description);
  if (!descriptionValidation.isValid) {
    return descriptionValidation;
  }

  return { isValid: true };
}