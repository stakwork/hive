import { db } from "@/lib/db";
import type {
  Swarm,
  User,
  Workspace,
  WorkspaceMember,
} from "@prisma/client";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { generateUniqueId } from "@/__tests__/helpers";
import {
  createTestUser,
  type CreateTestUserOptions,
} from "./user";
import {
  createTestSwarm,
  type CreateTestSwarmOptions,
} from "./swarm";

export interface CreateTestWorkspaceOptions {
  name?: string;
  description?: string | null;
  slug?: string;
  ownerId: string;
  stakworkApiKey?: string | null;
}

export interface CreateTestMembershipOptions {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
  leftAt?: Date;
}

export async function createTestWorkspace(
  options: CreateTestWorkspaceOptions,
): Promise<Workspace> {
  const uniqueId = generateUniqueId("workspace");

  return db.workspace.create({
    data: {
      name: options.name || `Test Workspace ${uniqueId}`,
      description:
        options.description === undefined ? null : options.description,
      slug: options.slug || `test-workspace-${uniqueId}`,
      ownerId: options.ownerId,
      stakworkApiKey:
        options.stakworkApiKey === undefined ? null : options.stakworkApiKey,
    },
  });
}

export async function createTestMembership(
  options: CreateTestMembershipOptions,
): Promise<WorkspaceMember> {
  return db.workspaceMember.create({
    data: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      role: options.role || "VIEWER",
      leftAt: options.leftAt || null,
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
}

export interface TestWorkspaceScenarioResult {
  owner: User;
  workspace: Workspace;
  members: User[];
  memberships: WorkspaceMember[];
  swarm: Swarm | null;
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
  } = options;

  const owner = await createTestUser({
    name: ownerOverrides?.name || "Workspace Owner",
    email: ownerOverrides?.email,
    role: ownerOverrides?.role,
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
      status: swarmOverrides.status,
      instanceType: swarmOverrides.instanceType,
    });
  }

  return {
    owner,
    workspace,
    members,
    memberships,
    swarm,
  };
}
