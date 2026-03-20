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
  /** Owner user ID - accepts both ownerId and owner_id for compatibility */
  ownerId?: string;
  owner_id?: string;
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
    const existing = await db.workspaces.findUnique({ where: { slug } });
    if (existing) return existing;
  }

  return db.workspaces.create({
    data: {
      id: generateUniqueId("workspace"),
      name,
      description,
      slug,owner_id: (options.ownerId ?? options.owner_id)!,stakwork_api_key: options.stakworkApiKey ?? null,source_control_org_id: options.sourceControlOrgId ?? null,repository_draft: options.repositoryDraft ?? null,
      updated_at: new Date(),
    },
  });
}

export async function createTestMembership(
  options: CreateTestMembershipOptions,
): Promise<WorkspaceMember> {
  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.workspace_members.findFirst({
      where: {workspace_id: options.workspaceId,user_id: options.userId,
      },
    });
    if (existing) return existing;
  }

  return db.workspace_members.create({
    data: {id: generateUniqueId("member"),workspace_id: options.workspaceId,user_id: options.userId,
      role: options.role || "VIEWER",left_at: options.leftAt || null,last_accessed_at: options.lastAccessedAt || null,
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

/**
 * Create a workspace with Sphinx integration enabled and configured.
 * Useful for testing Sphinx invite flows.
 */
export async function createSphinxEnabledWorkspace(options: {
  ownerId: string;
  name?: string;
  slug?: string;
  sphinxChatPubkey?: string;
  sphinxBotId?: string;
  sphinxBotSecret?: string;
}): Promise<Workspace> {
  const { EncryptionService } = await import("@/lib/encryption");
  const encryptionService = EncryptionService.getInstance();
  
  const uniqueId = generateUniqueId("workspace");
  const botSecret = options.sphinxBotSecret ?? `test-bot-secret-${uniqueId}`;
  
  // Encrypt the bot secret properly
  const encryptedData = encryptionService.encryptField("sphinxBotSecret", botSecret);
  const encryptedSecret = JSON.stringify(encryptedData);

  return db.workspaces.create({
    data: {
      id: generateUniqueId("workspace"),
      name: options.name ?? `Sphinx Workspace ${uniqueId}`,
      slug: options.slug ?? `sphinx-ws-${uniqueId}`,owner_id: (options.ownerId ?? (options as any).owner_id)!,sphinx_enabled: true,sphinx_chat_pubkey: options.sphinxChatPubkey ?? `test-chat-pubkey-${uniqueId}`,sphinx_bot_id: options.sphinxBotId ?? `test-bot-id-${uniqueId}`,sphinx_bot_secret: encryptedSecret,
      updated_at: new Date(),
    },
  });
}
