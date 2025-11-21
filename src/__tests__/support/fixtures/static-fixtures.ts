/**
 * Static in-memory test data factories.
 *
 * Note: This file contains static mock data builders for unit tests.
 * For Vitest mock configuration (e.g., mocking Prisma), see src/__tests__/mocks/
 */
import type { WorkspaceRole } from "@/lib/auth/roles";
import type { User, WorkspaceMember, Swarm, Workspace } from "@prisma/client";
import type { Session } from "next-auth";

export const mockData = {
  workspace(overrides: Record<string, unknown> = {}) {
    return {
      id: "ws-123",
      name: "Mock Workspace",
      description: "Mock description",
      slug: "mock-workspace",
      ownerId: "user-123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      userRole: "OWNER" as WorkspaceRole,
      memberCount: 1,
      ...overrides,
    };
  },

  workspaceResponse(overrides: Record<string, unknown> = {}) {
    return {
      id: "ws-123",
      name: "Mock Workspace",
      description: null,
      slug: "mock-workspace",
      ownerId: "user-123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      userRole: "OWNER" as WorkspaceRole,
      memberCount: 1,
      ...overrides,
    };
  },

  workspaces(count: number, overrides: Array<Partial<Workspace>> = []) {
    const roles: WorkspaceRole[] = ["OWNER", "ADMIN", "DEVELOPER", "PM", "STAKEHOLDER", "VIEWER"];

    return Array.from({ length: count }, (_, index) => ({
      id: `ws-${index + 1}`,
      name: `Workspace ${index + 1}`,
      description: null,
      slug: `workspace-${index + 1}`,
      ownerId: index === 0 ? "user-123" : `user-${index + 1}`,
      createdAt: `2024-01-0${index + 1}T00:00:00.000Z`,
      updatedAt: `2024-01-0${index + 1}T00:00:00.000Z`,
      userRole: roles[index % roles.length],
      memberCount: index + 2,
      ...((overrides[index] as Record<string, unknown> | undefined) || {}),
    }));
  },

  user(overrides: Partial<User> = {}) {
    return {
      id: "user-123",
      name: "Mock User",
      email: "mock@example.com",
      role: "USER",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    };
  },

  workspaceMember(overrides: Partial<WorkspaceMember> = {}) {
    return {
      id: "member-123",
      workspaceId: "ws-123",
      userId: "user-123",
      role: "DEVELOPER" as WorkspaceRole,
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      ...overrides,
    };
  },

  swarm(overrides: Partial<Swarm> = {}) {
    return {
      id: "swarm-123",
      name: "mock-swarm",
      status: "ACTIVE",
      instanceType: "XL",
      workspaceId: "ws-123",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    };
  },

  session(userId: string, overrides: Partial<Session["user"]> = {}): Session {
    return {
      user: {
        id: userId,
        name: "Test User",
        email: "test@example.com",
        image: null,
        ...overrides,
      },
      expires: "2024-12-31T00:00:00.000Z",
    };
  },

  githubAuth(overrides: Record<string, unknown> = {}) {
    return {
      userId: "user-123",
      githubUsername: "testuser",
      name: "Test User",
      bio: "Software Developer",
      publicRepos: 25,
      followers: 100,
      ...overrides,
    };
  },

  memberWithGithub(role: WorkspaceRole = "DEVELOPER", overrides: Record<string, unknown> = {}) {
    const userId = (overrides.userId as string) || "user-123";
    const username = (overrides.username as string) || "testuser";

    return {
      id: (overrides.id as string) || "member-123",
      userId,
      workspaceId: (overrides.workspaceId as string) || "ws-123",
      role,
      joinedAt: new Date("2024-01-01"),
      user: {
        id: userId,
        name: (overrides.name as string) || "Test User",
        email: (overrides.email as string) || `${username}@example.com`,
        image: (overrides.image as string | null) ?? `https://github.com/${username}.png`,
        githubAuth: {
          githubUsername: username,
          name: (overrides.name as string) || "Test User",
          bio: (overrides.bio as string) || "Software Developer",
          publicRepos: (overrides.publicRepos as number) || 25,
          followers: (overrides.followers as number) || 100,
        },
      },
      ...overrides,
    };
  },

  call(overrides: Record<string, unknown> = {}) {
    return {
      ref_id: "call-123",
      episode_title: "Meeting recording 2025-01-15T10:30:00",
      date_added_to_graph: 1750694095.264704,
      description: "Team sync meeting discussion",
      source_link: "https://example.com/recording-123.mp4",
      media_url: "https://example.com/recording-123.mp4",
      image_url: "https://example.com/thumbnail-123.jpg",
      ...overrides,
    };
  },

  jarvisNode(overrides: Record<string, unknown> = {}) {
    return {
      ref_id: "call-123",
      node_type: "Episode",
      date_added_to_graph: 1750694095.264704,
      properties: {
        episode_title: "Meeting recording 2025-01-15T10:30:00",
        media_url: "https://example.com/recording-123.mp4",
        source_link: "https://example.com/recording-123.mp4",
        description: "Team sync meeting discussion",
      },
      ...overrides,
    };
  },

  jarvisSearchResponse(nodes: Array<Record<string, unknown>> = []) {
    return {
      nodes: nodes.length > 0 ? nodes : [mockData.jarvisNode()],
      edges: [],
    };
  },

  callsResponse(overrides: Record<string, unknown> = {}) {
    const calls = (overrides.calls as Array<Record<string, unknown>>) || [mockData.call()];
    return {
      calls,
      total: (overrides.total as number) ?? calls.length,
      hasMore: (overrides.hasMore as boolean) ?? false,
      ...overrides,
    };
  },

  callWithParticipants(overrides: Record<string, unknown> = {}) {
    return {
      ref_id: "call-123",
      episode_title: "Meeting recording 2025-01-15T10:30:00",
      date_added_to_graph: 1750694095.264704,
      description: "Team sync meeting with participants",
      source_link: "https://example.com/recording-123.mp4",
      media_url: "https://example.com/recording-123.mp4",
      image_url: "https://example.com/thumbnail-123.jpg",
      participants: ["user-123", "user-456"],
      participant_count: 2,
      duration_minutes: 45,
      ...overrides,
    };
  },
};
