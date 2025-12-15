/**
 * Workspace Factory - Creates workspace entities with data from values layer
 */
import { db } from "@/lib/db";
import type { Workspace, WorkspaceMember } from "@prisma/client";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import {
  WORKSPACE_VALUES,
  getRandomWorkspace,
  type WorkspaceValueKey,
} from "../values/workspaces";

export interface CreateWorkspaceOptions {
  // Use named value from WORKSPACE_VALUES
  valueKey?: WorkspaceValueKey;
  // Or provide custom values (overrides valueKey)
  name?: string;
  description?: string | null;
  slug?: string;
  // Required
  ownerId: string;
  // Optional fields
  stakworkApiKey?: string | null;
  sourceControlOrgId?: string | null;
  repositoryDraft?: string | null;
  // Control behavior
  idempotent?: boolean; // If true, return existing if slug matches
}

/**
 * Create a single workspace
 *
 * @example
 * // Use named value
 * const workspace = await createWorkspace({ valueKey: "default", ownerId: owner.id });
 *
 * @example
 * // Use random values
 * const workspace = await createWorkspace({ ownerId: owner.id });
 *
 * @example
 * // Use custom values
 * const workspace = await createWorkspace({
 *   ownerId: owner.id,
 *   name: "My Workspace",
 *   slug: "my-workspace"
 * });
 */
export async function createWorkspace(options: CreateWorkspaceOptions): Promise<Workspace> {
  // Get base values from valueKey or random pool
  const baseValues = options.valueKey
    ? WORKSPACE_VALUES[options.valueKey]
    : getRandomWorkspace();

  const uniqueId = generateUniqueId("workspace");
  const slug = options.slug ?? baseValues.slug ?? `workspace-${uniqueId}`;

  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.workspace.findUnique({ where: { slug } });
    if (existing) return existing;
  }

  return db.workspace.create({
    data: {
      name: options.name ?? baseValues.name,
      description: options.description ?? baseValues.description ?? null,
      slug,
      ownerId: options.ownerId,
      stakworkApiKey: options.stakworkApiKey ?? "test-api-key",
      sourceControlOrgId: options.sourceControlOrgId ?? null,
      repositoryDraft: options.repositoryDraft ?? null,
    },
  });
}

export interface CreateMembershipOptions {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
  leftAt?: Date;
  lastAccessedAt?: Date;
  idempotent?: boolean;
}

/**
 * Create a workspace membership
 *
 * @example
 * const membership = await createMembership({
 *   workspaceId: workspace.id,
 *   userId: user.id,
 *   role: "DEVELOPER"
 * });
 */
export async function createMembership(options: CreateMembershipOptions): Promise<WorkspaceMember> {
  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.workspaceMember.findFirst({
      where: {
        workspaceId: options.workspaceId,
        userId: options.userId,
      },
    });
    if (existing) return existing;
  }

  return db.workspaceMember.create({
    data: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      role: options.role || "VIEWER",
      leftAt: options.leftAt || null,
      lastAccessedAt: options.lastAccessedAt || null,
    },
  });
}

/**
 * Create multiple workspaces with varied data
 *
 * @example
 * const workspaces = await createWorkspaces(3, owner.id);
 */
export async function createWorkspaces(count: number, ownerId: string): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];

  for (let i = 0; i < count; i++) {
    const workspace = await createWorkspace({ ownerId });
    workspaces.push(workspace);
  }

  return workspaces;
}

/**
 * Get or create a workspace by slug (always idempotent)
 */
export async function getOrCreateWorkspace(
  slug: string,
  options: Omit<CreateWorkspaceOptions, "slug" | "idempotent">
): Promise<Workspace> {
  return createWorkspace({ ...options, slug, idempotent: true });
}
