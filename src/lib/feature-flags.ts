import { WorkspaceRole } from '@prisma/client';

// Type-safe feature flag constants
export const FEATURE_FLAGS = {
  CODEBASE_RECOMMENDATION: 'CODEBASE_RECOMMENDATION',
  WORKSPACE_LOGO: 'WORKSPACE_LOGO',
} as const;

export type FeatureFlag = typeof FEATURE_FLAGS[keyof typeof FEATURE_FLAGS];

export function canAccessFeature(feature: FeatureFlag, userRole?: WorkspaceRole): boolean {
  let isEnabled = false;
  
  // Map feature names to their environment variables
  // This is needed because Next.js requires explicit env var references
  switch (feature) {
    case FEATURE_FLAGS.CODEBASE_RECOMMENDATION:
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION === 'true';
      break;
    case FEATURE_FLAGS.WORKSPACE_LOGO:
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_LOGO === 'true';
      break;
    default:
      isEnabled = false;
  }

  if (!isEnabled) return false;

  const roleRequirements: Record<FeatureFlag, WorkspaceRole[]> = {
    [FEATURE_FLAGS.CODEBASE_RECOMMENDATION]: [], // No role restriction - available to all when enabled
    [FEATURE_FLAGS.WORKSPACE_LOGO]: [], // No role restriction - available to all when enabled
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  if (allowedRoles.length === 0) return true; // Explicitly no role restriction
  return userRole ? allowedRoles.includes(userRole) : false;
}

// Server-side feature flag check (for API routes) - uses same logic but reads server-side env vars
export function canAccessServerFeature(feature: FeatureFlag, userRole?: WorkspaceRole): boolean {
  let isEnabled = false;
  
  // Use NEXT_PUBLIC_ for consistency - these are available server-side too
  switch (feature) {
    case FEATURE_FLAGS.CODEBASE_RECOMMENDATION:
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION === 'true';
      break;
    case FEATURE_FLAGS.WORKSPACE_LOGO:
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_LOGO === 'true';
      break;
    default:
      isEnabled = false;
  }

  if (!isEnabled) return false;

  const roleRequirements: Record<FeatureFlag, WorkspaceRole[]> = {
    [FEATURE_FLAGS.CODEBASE_RECOMMENDATION]: [], // No role restriction - available to all when enabled
    [FEATURE_FLAGS.WORKSPACE_LOGO]: [], // No role restriction - available to all when enabled
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  if (allowedRoles.length === 0) return true; // Explicitly no role restriction
  return userRole ? allowedRoles.includes(userRole) : false;
}