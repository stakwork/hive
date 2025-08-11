import { WorkspaceRole } from '@prisma/client';

export function canAccessFeature(feature: string, userRole?: WorkspaceRole): boolean {
  const isEnabled = process.env[`FEATURE_${feature.toUpperCase()}`] === 'true';
  if (!isEnabled) return false;

  const roleRequirements: Record<string, WorkspaceRole[]> = {
    'CHAT': ['ADMIN', 'OWNER'],
    'BULK_OPERATIONS': ['ADMIN', 'OWNER', 'PM'],
    'ADVANCED_ANALYTICS': ['OWNER'],
    'CODEBASE_RECOMMENDATION': [], // No role restriction - available to all when enabled
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  if (allowedRoles.length === 0) return true; // Explicitly no role restriction
  return userRole ? allowedRoles.includes(userRole) : false;
}