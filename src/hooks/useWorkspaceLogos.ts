import { useState, useEffect, useCallback } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import type { WorkspaceWithRole } from "@/types/workspace";

interface WorkspaceLogosMap {
  [workspaceId: string]: string;
}

export function useWorkspaceLogos(workspaces: WorkspaceWithRole[]) {
  const [logoUrls, setLogoUrls] = useState<WorkspaceLogosMap>({});
  const [loading, setLoading] = useState(false);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  // Function to fetch a single workspace logo
  const fetchWorkspaceLogo = useCallback(async (workspaceId: string, slug: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (response.ok) {
        const data = await response.json();
        return data.presignedUrl;
      }
      return null;
    } catch (error) {
      console.error(`Error fetching logo for workspace ${slug}:`, error);
      return null;
    }
  }, []);

  // Function to refetch a single logo and update state
  const refetchLogo = useCallback(async (workspaceId: string): Promise<string | null> => {
    const workspace = workspaces.find(ws => ws.id === workspaceId);
    if (!workspace) return null;

    const newUrl = await fetchWorkspaceLogo(workspaceId, workspace.slug);
    if (newUrl) {
      setLogoUrls(prev => ({
        ...prev,
        [workspaceId]: newUrl,
      }));
    }
    return newUrl;
  }, [workspaces, fetchWorkspaceLogo]);

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
