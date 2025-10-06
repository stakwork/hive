import { useEffect, useRef } from "react";
import { GitVisualizer } from "gitsee/client";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";

interface UseGitVisualizerProps {
  workspaceId: string | null;
  repositoryUrl: string | null;
  swarmUrl: string | null;
  containerId?: string;
}

export function useGitVisualizer({
  workspaceId,
  repositoryUrl,
  swarmUrl,
  containerId = "#vizzy",
}: UseGitVisualizerProps) {
  const vizInitialized = useRef(false);
  const vizRef = useRef<GitVisualizer | null>(null);

  useEffect(() => {
    // Reset initialization flag when dependencies change
    vizInitialized.current = false;

    if (!workspaceId || !repositoryUrl || !swarmUrl) {
      return;
    }

    if (vizInitialized.current) return;

    vizInitialized.current = true;
    let viz: GitVisualizer | null = null;

    try {
      const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);
      console.log("start GitVisualizer", owner, repo);

      const swarmUrlObj = new URL(swarmUrl);
      let gitseeUrl = `https://${swarmUrlObj.hostname}:3355`;
      if (swarmUrl.includes("localhost")) {
        gitseeUrl = `http://localhost:3355`;
      }

      viz = new GitVisualizer(
        containerId,
        `/api/gitsee?workspaceId=${workspaceId}`, // Nextjs proxy endpoint
        {}, // custom headers (not needed here since /api adds them)
        `${gitseeUrl}/gitsee`, // SSE endpoint
      );

      vizRef.current = viz;

      setTimeout(() => {
        viz?.visualize(owner, repo);
      }, 100);
    } catch (error) {
      console.error("Failed to visualize repository", error);
    }

    return () => {
      viz?.destroy();
      vizRef.current = null;
    };
  }, [workspaceId, repositoryUrl, swarmUrl, containerId]);

  // Cleanup function to manually destroy the visualizer
  const destroy = () => {
    if (vizRef.current) {
      vizRef.current.destroy();
      vizRef.current = null;
    }
  };

  return {
    destroy,
    isInitialized: vizInitialized.current,
  };
}
