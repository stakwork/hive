import { useState, useCallback } from 'react';

interface RepositoryPermissions {
  hasAccess: boolean;
  canPush: boolean;
  canAdmin: boolean;
  permissions?: Record<string, boolean>;
  repository?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  };
}

interface UseRepositoryPermissionsResult {
  permissions: RepositoryPermissions | null;
  loading: boolean;
  error: string | null;
  checkPermissions: (repositoryUrl: string, workspaceSlug?: string) => Promise<void>;
  reset: () => void;
}

export function useRepositoryPermissions(): UseRepositoryPermissionsResult {
  const [permissions, setPermissions] = useState<RepositoryPermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkPermissions = useCallback(async (repositoryUrl: string, workspaceSlug?: string) => {
    if (!repositoryUrl) {
      setError('Repository URL is required');
      return;
    }

    setLoading(true);
    setError(null);
    setPermissions(null);

    try {
      const response = await fetch('/api/github/repository/permissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositoryUrl,
          workspaceSlug
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setPermissions(result.data);
      } else {
        setError(result.error || result.message || 'Failed to check repository permissions');
      }
    } catch (err) {
      console.error('Error checking repository permissions:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPermissions(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    permissions,
    loading,
    error,
    checkPermissions,
    reset,
  };
}

// Helper function to get permission level description
export function getPermissionLevel(permissions: RepositoryPermissions | null): {
  level: 'none' | 'read' | 'write' | 'admin';
  description: string;
  canPerformAction: (action: 'read' | 'push' | 'admin') => boolean;
} {
  if (!permissions || !permissions.hasAccess) {
    return {
      level: 'none',
      description: 'No access to repository',
      canPerformAction: () => false,
    };
  }

  if (permissions.canAdmin) {
    return {
      level: 'admin',
      description: 'Full admin access to repository',
      canPerformAction: () => true,
    };
  }

  if (permissions.canPush) {
    return {
      level: 'write',
      description: 'Read and write access to repository',
      canPerformAction: (action) => action !== 'admin',
    };
  }

  return {
    level: 'read',
    description: 'Read-only access to repository',
    canPerformAction: (action) => action === 'read',
  };
}