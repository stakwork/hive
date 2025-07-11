import { redirect } from 'next/navigation';
import { Session } from 'next-auth';
import { getUserWorkspaces, getDefaultWorkspaceForUser } from '@/services/workspace';

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
export async function resolveUserWorkspaceRedirect(session: Session | null): Promise<WorkspaceResolutionResult> {
  if (!session?.user) {
    return {
      shouldRedirect: true,
      redirectUrl: '/auth/signin',
      workspaceCount: 0,
    };
  }

  const userId = (session.user as { id: string }).id;

  try {
    // Get all workspaces the user has access to
    const userWorkspaces = await getUserWorkspaces(userId);
    
    if (userWorkspaces.length === 0) {
      // User has no workspaces - redirect to onboarding
      return {
        shouldRedirect: true,
        redirectUrl: '/onboarding/workspace',
        workspaceCount: 0,
      };
    }

    if (userWorkspaces.length === 1) {
      // User has exactly one workspace - redirect to it
      const workspace = userWorkspaces[0];
      return {
        shouldRedirect: true,
        redirectUrl: `/w/${workspace.slug}`,
        workspaceCount: 1,
        defaultWorkspaceSlug: workspace.slug,
      };
    }

    // User has multiple workspaces - get their default
    const defaultWorkspace = await getDefaultWorkspaceForUser(userId);
    
    if (defaultWorkspace) {
      return {
        shouldRedirect: true,
        redirectUrl: `/w/${defaultWorkspace.slug}`,
        workspaceCount: userWorkspaces.length,
        defaultWorkspaceSlug: defaultWorkspace.slug,
      };
    }

    // Fallback to first workspace
    const fallbackWorkspace = userWorkspaces[0];
    return {
      shouldRedirect: true,
      redirectUrl: `/w/${fallbackWorkspace.slug}`,
      workspaceCount: userWorkspaces.length,
      defaultWorkspaceSlug: fallbackWorkspace.slug,
    };

  } catch (error) {
    console.error('Error resolving workspace redirect:', error);
    
    // On error, redirect to onboarding to be safe
    return {
      shouldRedirect: true,
      redirectUrl: '/onboarding/workspace',
      workspaceCount: 0,
    };
  }
}

/**
 * Handles workspace redirection for server components
 * This is a convenience function that calls resolveUserWorkspaceRedirect and performs the redirect
 */
export async function handleWorkspaceRedirect(session: Session | null): Promise<void> {
  const result = await resolveUserWorkspaceRedirect(session);
  
  if (result.shouldRedirect && result.redirectUrl) {
    redirect(result.redirectUrl);
  }
}

/**
 * Validates if a user has access to a specific workspace
 * Returns the workspace slug if valid, null otherwise
 */
export async function validateUserWorkspaceAccess(session: Session | null, requestedSlug: string): Promise<string | null> {
  if (!session?.user) {
    return null;
  }

  const userId = (session.user as { id: string }).id;

  try {
    const userWorkspaces = await getUserWorkspaces(userId);
    const hasAccess = userWorkspaces.some(workspace => workspace.slug === requestedSlug);
    
    return hasAccess ? requestedSlug : null;
  } catch (error) {
    console.error('Error validating workspace access:', error);
    return null;
  }
} 