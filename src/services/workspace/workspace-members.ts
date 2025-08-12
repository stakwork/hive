import { db } from "@/lib/db";
import { WorkspaceRole } from "@/types/workspace";
import { mapWorkspaceMembers, mapWorkspaceMember } from "@/lib/mappers/workspace-member";
import {
  findUserByGitHubUsername,
  findActiveMember,
  findPreviousMember,
  isWorkspaceOwner,
  createWorkspaceMember,
  reactivateWorkspaceMember,
  getActiveWorkspaceMembers,
  updateMemberRole,
  softDeleteMember,
} from "@/lib/helpers/workspace-member-queries";

/**
 * Gets all members and owner information for a workspace
 */
export async function getWorkspaceMembers(workspaceId: string) {
  // Get regular members from workspace_members table
  const members = await getActiveWorkspaceMembers(workspaceId);
  
  // Get workspace owner information
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: {
        include: {
          githubAuth: {
            select: {
              githubUsername: true,
              name: true,
              bio: true,
              publicRepos: true,
              followers: true,
            },
          },
        },
      },
    },
  });

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  // Map owner to WorkspaceMember format for consistent UI
  const owner = {
    id: workspace.owner.id, // Use real user ID
    userId: workspace.owner.id,
    role: "OWNER" as const,
    joinedAt: workspace.createdAt.toISOString(),
    user: {
      id: workspace.owner.id,
      name: workspace.owner.name,
      email: workspace.owner.email,
      image: workspace.owner.image,
      github: workspace.owner.githubAuth
        ? {
            username: workspace.owner.githubAuth.githubUsername,
            name: workspace.owner.githubAuth.name,
            bio: workspace.owner.githubAuth.bio,
            publicRepos: workspace.owner.githubAuth.publicRepos,
            followers: workspace.owner.githubAuth.followers,
          }
        : null,
    },
  };

  return {
    members: mapWorkspaceMembers(members),
    owner,
  };
}

/**
 * Adds an existing Hive user to a workspace by GitHub username
 * Note: User must already be registered in the system
 */
export async function addWorkspaceMember(
  workspaceId: string,
  githubUsername: string,
  role: WorkspaceRole,
) {
  // Find existing user by GitHub username
  const githubAuth = await findUserByGitHubUsername(githubUsername);
  if (!githubAuth) {
    throw new Error("User not found. They must sign up to Hive first.");
  }

  const userId = githubAuth.userId;

  // Check if user is already an active member
  const activeMember = await findActiveMember(workspaceId, userId);
  if (activeMember) {
    throw new Error("User is already a member of this workspace");
  }

  // Check if user is the workspace owner
  const isOwner = await isWorkspaceOwner(workspaceId, userId);
  if (isOwner) {
    throw new Error("Cannot add workspace owner as a member");
  }

  // Check if user was previously a member (soft deleted)
  const previousMember = await findPreviousMember(workspaceId, userId);

  // Add the member (either create new or reactivate previous)
  const member = previousMember
    ? await reactivateWorkspaceMember(previousMember.id, role)
    : await createWorkspaceMember(workspaceId, userId, role);

  return mapWorkspaceMember(member);
}

/**
 * Updates a workspace member's role
 */
export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
) {
  const member = await findActiveMember(workspaceId, userId);
  if (!member) {
    throw new Error("Member not found");
  }
  
  // Check if the new role is the same as current role
  if (member.role === newRole) {
    throw new Error("Member already has this role");
  }

  const updatedMember = await updateMemberRole(member.id, newRole);
  return mapWorkspaceMember(updatedMember);
}

/**
 * Removes a member from a workspace
 */
export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
) {
  const member = await findActiveMember(workspaceId, userId);
  if (!member) {
    throw new Error("Member not found");
  }

  await softDeleteMember(member.id);
}