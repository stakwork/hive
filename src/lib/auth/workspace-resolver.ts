import {
  getDefaultWorkspaceForUser,
  getUserWorkspaces,
} from "@/services/workspace";
import { Session } from "next-auth";
import { redirect } from "next/navigation";

export interface WorkspaceResolutionResult {
  shouldRedirect: boolean;
  redirectUrl?: string;
  workspaceCount: number;
  defaultWorkspaceSlug?: string;
}

/**
 * Resolves where a user should be redirected based on their workspace access
 * This function handles the post-authentication routing logic
 */
export async function resolveUserWorkspaceRedirect(
  session: Session,
): Promise<WorkspaceResolutionResult> {
  const userId = (session.user as { id: string }).id;

  try {
    // Get all workspaces the user has access to
    const userWorkspaces = await getUserWorkspaces(userId);

    if (process.env.POD_URL && userWorkspaces.length === 0) {
      return {
        shouldRedirect: true,
        redirectUrl: "/auth/signin",
        workspaceCount: 0,
      };
    }

    if (userWorkspaces.length === 0) {
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
      return {
        shouldRedirect: true,
        redirectUrl: `/w/${workspace.slug}/tasks`,
        workspaceCount: 1,
        defaultWorkspaceSlug: workspace.slug,
      };
    }

    // User has multiple workspaces - get their default
    const defaultWorkspace = await getDefaultWorkspaceForUser(userId);

    if (defaultWorkspace) {
      return {
        shouldRedirect: true,
        redirectUrl: `/w/${defaultWorkspace.slug}/tasks`,
        workspaceCount: userWorkspaces.length,
        defaultWorkspaceSlug: defaultWorkspace.slug,
      };
    }

    // Fallback to first workspace
    const fallbackWorkspace = userWorkspaces[0];
    return {
      shouldRedirect: true,
      redirectUrl: `/w/${fallbackWorkspace.slug}/tasks`,
      workspaceCount: userWorkspaces.length,
      defaultWorkspaceSlug: fallbackWorkspace.slug,
    };
  } catch (error) {
    console.error("Error resolving workspace redirect:", error);

    // On error, redirect to onboarding to be safe
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
export async function handleWorkspaceRedirect(session: Session): Promise<void> {
  const result = await resolveUserWorkspaceRedirect(session);

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
  // Check if session exists
  if (!session) {
    console.debug("validateUserWorkspaceAccess: No session provided");
    return null;
  }

  // Check if session has user
  if (!session.user) {
    console.debug("validateUserWorkspaceAccess: Session has no user");
    return null;
  }

  // Check if user has ID
  const userWithId = session.user as { id?: string };
  if (!userWithId.id) {
    console.error("validateUserWorkspaceAccess: Session user has no ID", {
      sessionUser: session.user,
    });
    return null;
  }

  const userId = userWithId.id;

  // Validate inputs
  if (!requestedSlug || typeof requestedSlug !== 'string') {
    console.error("validateUserWorkspaceAccess: Invalid requestedSlug", {
      requestedSlug,
      type: typeof requestedSlug,
    });
    return null;
  }

  // Normalize the slug (trim whitespace)
  const normalizedSlug = requestedSlug.trim();
  if (!normalizedSlug) {
    console.error("validateUserWorkspaceAccess: Empty slug after normalization");
    return null;
  }

  try {
    console.debug("validateUserWorkspaceAccess: Checking access", {
      userId,
      requestedSlug: normalizedSlug,
    });

    const userWorkspaces = await getUserWorkspaces(userId);
    
    console.debug("validateUserWorkspaceAccess: Retrieved workspaces", {
      userId,
      workspaceCount: userWorkspaces.length,
      workspaceSlugs: userWorkspaces.map(w => w.slug),
      requestedSlug: normalizedSlug,
    });

    const hasAccess = userWorkspaces.some(
      (workspace) => workspace.slug === normalizedSlug,
    );

    if (!hasAccess) {
      console.warn("validateUserWorkspaceAccess: Access denied", {
        userId,
        requestedSlug: normalizedSlug,
        availableWorkspaces: userWorkspaces.map(w => ({
          slug: w.slug,
          name: w.name,
          role: w.userRole,
        })),
      });
    } else {
      console.debug("validateUserWorkspaceAccess: Access granted", {
        userId,
        requestedSlug: normalizedSlug,
      });
    }

    return hasAccess ? normalizedSlug : null;
  } catch (error) {
    console.error("validateUserWorkspaceAccess: Database error", {
      userId,
      requestedSlug: normalizedSlug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}
