import { WorkspaceRole } from '@prisma/client';

export function canAccessFeature(feature: string, userRole?: WorkspaceRole): boolean {
  let isEnabled = false;
  
  // Map feature names to their environment variables
  // This is needed because Next.js requires explicit env var references
  switch (feature) {
    case 'CODEBASE_RECOMMENDATION':
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION === 'true';
      break;
    default:
      isEnabled = false;
  }
  
  if (!isEnabled) return false;

  const roleRequirements: Record<string, WorkspaceRole[]> = {
    'CODEBASE_RECOMMENDATION': [], // No role restriction - available to all when enabled
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  if (allowedRoles.length === 0) return true; // Explicitly no role restriction
  return userRole ? allowedRoles.includes(userRole) : false;
}