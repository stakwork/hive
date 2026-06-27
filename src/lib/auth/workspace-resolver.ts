import {
  getDefaultWorkspaceForUser,
  getUserWorkspaces,
  getWorkspaceOrgGithubLogin,
} from "@/services/workspace";
import { Session } from "next-auth";
import { redirect } from "next/navigation";

export interface WorkspaceResolutionResult {
  shouldRedirect: boolean;
  redirectUrl?: string;
  workspaceCount: number;
  defaultWorkspaceSlug?: string;
}

/** Routes that workspace-less authenticated users may access without onboarding redirect. */
export const WORKSPACE_FREE_ROUTES = ['/settings', '/profile'];

/**
 * Builds the redirect URL for a resolved workspace.
 * Prefers `/org/<githubLogin>` when the workspace has an associated org,
 * falling back to `/w/<slug>`.
 */
async function buildWorkspaceRedirectUrl(
  workspaceId: string,
  slug: string,
): Promise<string> {
  const githubLogin = await getWorkspaceOrgGithubLogin(workspaceId);
  return githubLogin ? `/org/${githubLogin}` : `/w/${slug}`;
}

/**
 * Resolves where a user should be redirected based on their workspace access
 * This function handles the post-authentication routing logic
 */
export async function resolveUserWorkspaceRedirect(
  session: Session,
  requestedPath?: string,
): Promise<WorkspaceResolutionResult> {
  const userId = (session.user as { id: string }).id;

  try {
    // Get all workspaces the user has access to
    const userWorkspaces = await getUserWorkspaces(userId);

    if (process.env.POD_URL && userWorkspaces.length === 0) {
      const isFreeRoute = WORKSPACE_FREE_ROUTES.some(r => requestedPath?.startsWith(r));
      if (isFreeRoute) {
        return { shouldRedirect: false, workspaceCount: 0 };
      }
      return {
        shouldRedirect: true,
        redirectUrl: "/auth/signin",
        workspaceCount: 0,
      };
    }

    if (userWorkspaces.length === 0) {
      const isFreeRoute = WORKSPACE_FREE_ROUTES.some(r => requestedPath?.startsWith(r));
      if (isFreeRoute) {
        return { shouldRedirect: false, workspaceCount: 0 };
      }
      // User has no workspaces - redirect to onboarding
      return {
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      };
    }

    if (userWorkspaces.length === 1) {
      // User has exactly one workspace - redirect to it
      const workspace = userWorkspaces[0];
      const redirectUrl = await buildWorkspaceRedirectUrl(workspace.id, workspace.slug);
      return {
        shouldRedirect: true,
        redirectUrl,
        workspaceCount: 1,
        defaultWorkspaceSlug: workspace.slug,
      };
    }

    // User has multiple workspaces - get their default
    const defaultWorkspace = await getDefaultWorkspaceForUser(userId);

    if (defaultWorkspace) {
      const redirectUrl = await buildWorkspaceRedirectUrl(defaultWorkspace.id, defaultWorkspace.slug);
      return {
        shouldRedirect: true,
        redirectUrl,
        workspaceCount: userWorkspaces.length,
        defaultWorkspaceSlug: defaultWorkspace.slug,
      };
    }

    // Fallback to first workspace
    const fallbackWorkspace = userWorkspaces[0];
    const redirectUrl = await buildWorkspaceRedirectUrl(fallbackWorkspace.id, fallbackWorkspace.slug);
    return {
      shouldRedirect: true,
      redirectUrl,
      workspaceCount: userWorkspaces.length,
      defaultWorkspaceSlug: fallbackWorkspace.slug,
    };
  } catch (error) {
    console.error("Error resolving workspace redirect:", error);

    // On error, allow free routes through; otherwise redirect to onboarding to be safe
    const isFreeRoute = WORKSPACE_FREE_ROUTES.some(r => requestedPath?.startsWith(r));
    if (isFreeRoute) {
      return { shouldRedirect: false, workspaceCount: 0 };
    }
    return {
      shouldRedirect: true,
      redirectUrl: "/onboarding/workspace",
      workspaceCount: 0,
    };
  }
}

/**
 * Handles workspace redirection for server components
 * This is a convenience function that calls resolveUserWorkspaceRedirect and performs the redirect
 */
export async function handleWorkspaceRedirect(session: Session, requestedPath?: string): Promise<void> {
  const result = await resolveUserWorkspaceRedirect(session, requestedPath);

  if (result.shouldRedirect && result.redirectUrl) {
    redirect(result.redirectUrl);
  }
}

/**
 * Validates if a user has access to a specific workspace
 * Returns the workspace slug if valid, null otherwise
 */
export async function validateUserWorkspaceAccess(
  session: Session | null,
  requestedSlug: string,
): Promise<string | null> {
  if (!session?.user) {
    return null;
  }

  const userId = (session.user as { id: string }).id;

  try {
    const userWorkspaces = await getUserWorkspaces(userId);
    const hasAccess = userWorkspaces.some(
      (workspace) => workspace.slug === requestedSlug,
    );

    return hasAccess ? requestedSlug : null;
  } catch (error) {
    console.error("Error validating workspace access:", error);
    return null;
  }
}
