import { db } from "@/lib/db";
import type {
  Swarm,
  User,
  Workspace,
  WorkspaceMember,
} from "@prisma/client";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import {
  createTestUser,
  type CreateTestUserOptions,
} from "./user.factory";
import {
  createTestSwarm,
  type CreateTestSwarmOptions,
} from "./swarm.factory";
import {
  WORKSPACE_VALUES,
  getRandomWorkspace,
  type WorkspaceValueKey,
} from "../values/workspaces";

export interface CreateTestWorkspaceOptions {
  /** Use named value from WORKSPACE_VALUES (e.g., "default", "e2eTest") */
  valueKey?: WorkspaceValueKey;
  name?: string;
  description?: string | null;
  slug?: string;
  ownerId: string;
  stakworkApiKey?: string | null;
  sourceControlOrgId?: string | null;
  repositoryDraft?: string | null;
  /** If true, return existing workspace if slug matches */
  idempotent?: boolean;
}

export interface CreateTestMembershipOptions {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
  leftAt?: Date;
  lastAccessedAt?: Date;
  /** If true, return existing membership if workspace+user match */
  idempotent?: boolean;
}

export async function createTestWorkspace(
  options: CreateTestWorkspaceOptions,
): Promise<Workspace> {
  // Get base values from valueKey or generate unique defaults
  const baseValues = options.valueKey
    ? WORKSPACE_VALUES[options.valueKey]
    : null;

  const uniqueId = generateUniqueId("workspace");
  const slug = options.slug ?? baseValues?.slug ?? `test-workspace-${uniqueId}`;
  const name = options.name ?? baseValues?.name ?? `Test Workspace ${uniqueId}`;
  const description = options.description ?? baseValues?.description ?? null;

  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.workspace.findUnique({ where: { slug } });
    if (existing) return existing;
  }

  return db.workspace.create({
    data: {
      name,
      description,
      slug,
      ownerId: options.ownerId,
      stakworkApiKey: options.stakworkApiKey ?? null,
      sourceControlOrgId: options.sourceControlOrgId ?? null,
      repositoryDraft: options.repositoryDraft ?? null,
    },
  });
}

export async function createTestMembership(
  options: CreateTestMembershipOptions,
): Promise<WorkspaceMember> {
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

export interface WorkspaceMemberBlueprint {
  user?: CreateTestUserOptions;
  role?: WorkspaceRole;
  withGitHubAuth?: boolean;
  githubUsername?: string;
}

export interface CreateTestWorkspaceScenarioOptions {
  owner?: CreateTestUserOptions;
  members?: WorkspaceMemberBlueprint[];
  memberCount?: number;
  workspace?: Partial<Omit<CreateTestWorkspaceOptions, "ownerId">>;
  withSwarm?: boolean;
  swarm?: Partial<CreateTestSwarmOptions>;
  withPods?: boolean;
  podCount?: number;
}

export interface TestWorkspaceScenarioResult {
  owner: User;
  workspace: Workspace;
  members: User[];
  memberships: WorkspaceMember[];
  swarm: Swarm | null;
  pods: Pod[];
}

export async function createTestWorkspaceScenario(
  options: CreateTestWorkspaceScenarioOptions = {},
): Promise<TestWorkspaceScenarioResult> {
  const {
    owner: ownerOverrides,
    members: memberBlueprints = [],
    memberCount = memberBlueprints.length,
    workspace: workspaceOverrides = {},
    withSwarm = false,
    swarm: swarmOverrides = {},
    withPods = false,
    podCount = 1,
  } = options;

  const owner = await createTestUser({
    name: ownerOverrides?.name || "Workspace Owner",
    email: ownerOverrides?.email,
    role: ownerOverrides?.role,
    withGitHubAuth: ownerOverrides?.withGitHubAuth,
    githubUsername: ownerOverrides?.githubUsername,
  });

  const workspace = await createTestWorkspace({
    ownerId: owner.id,
    name: workspaceOverrides.name,
    description: workspaceOverrides.description ?? null,
    slug: workspaceOverrides.slug,
    stakworkApiKey: workspaceOverrides.stakworkApiKey ?? "test-api-key",
  });

  const defaultRoles: WorkspaceRole[] = [
    "ADMIN",
    "PM",
    "DEVELOPER",
    "STAKEHOLDER",
    "VIEWER",
  ];

  const effectiveMemberBlueprints =
    memberBlueprints.length > 0
      ? memberBlueprints
      : Array.from({ length: memberCount }, (_, index) => ({
          role: defaultRoles[index % defaultRoles.length],
        }));

  const members: User[] = [];
  const memberships: WorkspaceMember[] = [];

  for (const blueprint of effectiveMemberBlueprints) {
    const userOptions = "user" in blueprint ? blueprint.user : undefined;
    const member = await createTestUser({
      name: userOptions?.name,
      email: userOptions?.email,
      role: userOptions?.role,
      withGitHubAuth: blueprint.withGitHubAuth || userOptions?.withGitHubAuth,
      githubUsername: blueprint.githubUsername || userOptions?.githubUsername,
    });

    members.push(member);

    const membership = await createTestMembership({
      workspaceId: workspace.id,
      userId: member.id,
      role: blueprint.role || "VIEWER",
    });

    memberships.push(membership);
  }

  let swarm: Swarm | null = null;

  if (withSwarm) {
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: swarmOverrides.name,
      swarmUrl: swarmOverrides.swarmUrl,
      status: swarmOverrides.status,
      instanceType: swarmOverrides.instanceType,
      swarmApiKey: swarmOverrides.swarmApiKey ?? (process.env.TOKEN_ENCRYPTION_KEY ? "test-swarm-api-key" : undefined),
      containerFilesSetUp: swarmOverrides.containerFilesSetUp,
      poolState: swarmOverrides.poolState,
    });
  }

  const pods: Pod[] = [];

  if (withPods && swarm) {
    const { createTestPod } = await import('./pod.factory');
    for (let i = 0; i < podCount; i++) {
      const pod = await createTestPod({
        swarmId: swarm.id,
      });
      pods.push(pod);
    }
  }

  return {
    owner,
    workspace,
    members,
    memberships,
    swarm,
    pods,
  };
}
