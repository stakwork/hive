import { useState, useEffect, useMemo, useCallback } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";

interface WorkspaceLogosMap {
  [workspaceId: string]: string;
}

// Minimal workspace interface for logo fetching
interface WorkspaceForLogo {
  id: string;
  slug: string;
  logoKey?: string | null;
}

// MODULE-LEVEL cache - survives component remounts
const logoCache = new Map<string, string>();

export function useWorkspaceLogos(workspaces: WorkspaceForLogo[]) {
  const [logoUrls, setLogoUrls] = useState<WorkspaceLogosMap>(() => {
    // Initialize state from cache on mount
    const initialUrls: WorkspaceLogosMap = {};
    workspaces.forEach(ws => {
      if (logoCache.has(ws.id)) {
        initialUrls[ws.id] = logoCache.get(ws.id)!;
      }
    });
    return initialUrls;
  });

  const [loading, setLoading] = useState(false);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  // Create stable dependency - only changes when workspace IDs with logoKey change
  const workspaceKey = useMemo(
    () => workspaces
      .filter(ws => ws.logoKey)
      .map(ws => ws.id)
      .sort()
      .join(','),
    [workspaces]
  );

  const fetchLogos = useCallback(async (force = false) => {
    if (!canAccessWorkspaceLogo || workspaces.length === 0) {
      return;
    }

    // Only fetch what's not in cache (or all if forced)
    const workspacesToFetch = workspaces.filter(
      ws => ws.logoKey && (force || !logoCache.has(ws.id))
    );

    if (workspacesToFetch.length === 0) {
      return;
    }

    setLoading(true);
    const urls: WorkspaceLogosMap = {};

    await Promise.all(
      workspacesToFetch.map(async (workspace) => {
        try {
          const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
          if (response.ok) {
            const data = await response.json();
            urls[workspace.id] = data.presignedUrl;
            logoCache.set(workspace.id, data.presignedUrl);
          }
        } catch (error) {
          console.error(`Error fetching logo for workspace ${workspace.slug}:`, error);
        }
      })
    );

    setLogoUrls(prev => ({ ...prev, ...urls }));
    setLoading(false);
  }, [canAccessWorkspaceLogo, workspaces]);

  useEffect(() => {
    fetchLogos();
  }, [fetchLogos, workspaceKey]);

  // Refresh specific workspace logo (clears cache and refetches)
  const refreshLogo = useCallback((workspaceId: string) => {
    logoCache.delete(workspaceId);
    fetchLogos(true);
  }, [fetchLogos]);

  return { logoUrls, loading, refreshLogo };
}
