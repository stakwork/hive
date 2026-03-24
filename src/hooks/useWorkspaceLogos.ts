import { useState, useEffect, useCallback } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { getCachedLogoUrl, setCachedLogoUrl } from "@/lib/workspace-logo-cache";
import type { WorkspaceWithRole } from "@/types/workspace";

interface WorkspaceLogosMap {
  [workspaceId: string]: string;
}

export function useWorkspaceLogos(workspaces: WorkspaceWithRole[]) {
  const [logoUrls, setLogoUrls] = useState<WorkspaceLogosMap>({});
  const [loading, setLoading] = useState(false);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  // Fetch a single workspace logo, checking the cache first
  const fetchWorkspaceLogo = useCallback(async (workspaceId: string, slug: string): Promise<string | null> => {
    const cached = getCachedLogoUrl(workspaceId);
    if (cached) return cached;

    try {
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (response.ok) {
        const data = await response.json();
        const url: string = data.presignedUrl;
        setCachedLogoUrl(workspaceId, url);
        return url;
      }
      return null;
    } catch (error) {
      console.error(`Error fetching logo for workspace ${slug}:`, error);
      return null;
    }
  }, []);

  // Force-refresh a single logo, bypassing the cache
  const refetchLogo = useCallback(async (workspaceId: string): Promise<string | null> => {
    const workspace = workspaces.find(ws => ws.id === workspaceId);
    if (!workspace) return null;

    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
      if (response.ok) {
        const data = await response.json();
        const newUrl: string = data.presignedUrl;
        setCachedLogoUrl(workspaceId, newUrl);
        setLogoUrls(prev => ({ ...prev, [workspaceId]: newUrl }));
        return newUrl;
      }
      return null;
    } catch (error) {
      console.error(`Error refetching logo for workspace ${workspace.slug}:`, error);
      return null;
    }
  }, [workspaces]);

  useEffect(() => {
    if (!canAccessWorkspaceLogo || workspaces.length === 0) {
      setLogoUrls({});
      return;
    }

    const fetchLogos = async () => {
      setLoading(true);
      const urls: WorkspaceLogosMap = {};

      await Promise.all(
        workspaces
          .filter((ws) => ws.logoKey)
          .map(async (workspace) => {
            const url = await fetchWorkspaceLogo(workspace.id, workspace.slug);
            if (url) {
              urls[workspace.id] = url;
            }
          })
      );

      setLogoUrls(urls);
      setLoading(false);
    };

    fetchLogos();
  }, [canAccessWorkspaceLogo, workspaces, fetchWorkspaceLogo]);

  return { logoUrls, loading, refetchLogo };
}
