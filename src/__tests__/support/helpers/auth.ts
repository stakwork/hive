import type { User, Workspace } from "@prisma/client";
import type { Session } from "next-auth";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { getServerSession } from "next-auth/next";
import { vi } from "vitest";

/**
 * Create a mock authenticated session for a user
 * Use this to mock NextAuth's getServerSession in tests
 */
export function createAuthenticatedSession(user: Pick<User, "id" | "email">): Session {
  return {
    user: {
      id: user.id,
      email: user.email,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
  };
}

/**
 * Get mocked getServerSession function for integration tests
 * Use this after global mock is set up in setup/global.ts
 */
export function getMockedSession() {
  return getServerSession as vi.MockedFunction<typeof getServerSession>;
}

/**
 * Mock session for current test
 * Convenience wrapper for setting up authentication in tests
 */
export function mockSessionAs(session: Session | null) {
  const mock = getMockedSession();
  mock.mockResolvedValue(session);
  return mock;
}

/**
 * Create a mock authenticated session with workspace context
 * Use this when tests need both user authentication and workspace membership
 */
export function createWorkspaceSession(
  user: Pick<User, "id" | "email">,
  workspace?: Pick<Workspace, "id" | "slug">,
  role?: WorkspaceRole,
): Session {
  const session = createAuthenticatedSession(user);

  if (workspace) {
    // Add workspace context to session (can be extended as needed)
    (session as any).workspace = {
      id: workspace.id,
      slug: workspace.slug,
      role: role || "VIEWER",
    };
  }

  return session;
}

/**
 * Mock an unauthenticated session (returns null)
 * Use this to test 401 Unauthorized cases
 */
export function mockUnauthenticatedSession(): null {
  return null;
}
