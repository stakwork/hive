import { useState, useEffect } from "react";
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
            try {
              const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
              if (response.ok) {
                const data = await response.json();
                urls[workspace.id] = data.presignedUrl;
              }
            } catch (error) {
              console.error(`Error fetching logo for workspace ${workspace.slug}:`, error);
            }
          })
      );

      setLogoUrls(urls);
      setLoading(false);
    };

    fetchLogos();
  }, [canAccessWorkspaceLogo, workspaces]);

  return { logoUrls, loading };
}
