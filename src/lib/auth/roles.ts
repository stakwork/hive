import { WorkspaceRole } from "@prisma/client";
import { z } from "zod";

/**
 * Re-export WorkspaceRole from Prisma as the single source of truth
 */
export { WorkspaceRole };

/**
 * Type guard to check if a value is a valid WorkspaceRole
 */
export const isWorkspaceRole = (value: unknown): value is WorkspaceRole => {
  return typeof value === "string" && 
    Object.values(WorkspaceRole).includes(value as WorkspaceRole);
};

/**
 * Roles that can be assigned via membership endpoints
 * (excludes OWNER and STAKEHOLDER which have special handling)
 */
export const AssignableMemberRoles: readonly WorkspaceRole[] = [
  WorkspaceRole.VIEWER,
  WorkspaceRole.DEVELOPER,
  WorkspaceRole.PM,
  WorkspaceRole.ADMIN,
] as const;

/**
 * Type for roles that can be assigned via membership endpoints
 */
export type AssignableMemberRole = typeof AssignableMemberRoles[number];

/**
 * Type guard to check if a role is assignable via membership endpoints
 */
export const isAssignableMemberRole = (value: unknown): value is AssignableMemberRole => {
  return typeof value === "string" && 
    AssignableMemberRoles.includes(value as AssignableMemberRole);
};

/**
 * Zod schema for WorkspaceRole validation
 */
export const WorkspaceRoleSchema = z.nativeEnum(WorkspaceRole);

/**
 * Zod schema for AssignableMemberRole validation
 */
export const AssignableMemberRoleSchema = z.enum([
  WorkspaceRole.VIEWER,
  WorkspaceRole.DEVELOPER,
  WorkspaceRole.PM,
  WorkspaceRole.ADMIN,
]);

/**
 * Human-readable role labels for UI display
 */
export const RoleLabels: Record<WorkspaceRole, string> = {
  [WorkspaceRole.OWNER]: "Owner",
  [WorkspaceRole.ADMIN]: "Admin",
  [WorkspaceRole.PM]: "Product Manager", 
  [WorkspaceRole.DEVELOPER]: "Developer",
  [WorkspaceRole.STAKEHOLDER]: "Stakeholder",
  [WorkspaceRole.VIEWER]: "Viewer",
};

/**
 * Role hierarchy for permission comparisons (higher number = more permissions)
 */
export const RoleHierarchy: Record<WorkspaceRole, number> = {
  [WorkspaceRole.VIEWER]: 1,
  [WorkspaceRole.STAKEHOLDER]: 2,
  [WorkspaceRole.DEVELOPER]: 3,
  [WorkspaceRole.PM]: 4,
  [WorkspaceRole.ADMIN]: 5,
  [WorkspaceRole.OWNER]: 6,
};

/**
 * Check if a role has at least the specified minimum role level
 */
export const hasRoleLevel = (userRole: WorkspaceRole, minimumRole: WorkspaceRole): boolean =>
  RoleHierarchy[userRole] >= RoleHierarchy[minimumRole];