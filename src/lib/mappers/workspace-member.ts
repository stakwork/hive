import type { WorkspaceMember } from "@/types/workspace";

// Shared Prisma include clause for consistent data fetching
export const WORKSPACE_MEMBER_INCLUDE = {
  user: {
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
} as const;

// Type for the Prisma result with includes
export type PrismaWorkspaceMemberWithUser = {
  id: string;
  userId: string;
  role: string;
  joinedAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    githubAuth: {
      githubUsername: string;
      name: string | null;
      bio: string | null;
      publicRepos: number | null;
      followers: number | null;
    } | null;
  };
};

/**
 * Maps a Prisma workspace member with user data to the API response format
 */
export function mapWorkspaceMember(member: PrismaWorkspaceMemberWithUser): WorkspaceMember {
  return {
    id: member.id,
    userId: member.user.id,
    role: member.role as WorkspaceMember["role"],
    joinedAt: member.joinedAt.toISOString(),
    user: {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      github: member.user.githubAuth
        ? {
            username: member.user.githubAuth.githubUsername,
            name: member.user.githubAuth.name,
            bio: member.user.githubAuth.bio,
            publicRepos: member.user.githubAuth.publicRepos,
            followers: member.user.githubAuth.followers,
          }
        : null,
    },
  };
}

/**
 * Maps multiple Prisma workspace members to API response format
 */
export function mapWorkspaceMembers(members: PrismaWorkspaceMemberWithUser[]): WorkspaceMember[] {
  return members.map(mapWorkspaceMember);
}