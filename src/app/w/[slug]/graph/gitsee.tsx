import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useGitVisualizer } from "@/hooks/useGitVisualizer";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useEffect } from "react";

export const Gitsee = () => {
  const { id: workspaceId, slug } = useWorkspace();
  const { formData, loadSettings } = useStakgraphStore();

  useEffect(() => {
    if (slug) {
      loadSettings(slug);
    }
  }, [slug, loadSettings]);

  const primaryRepoUrl = formData.repositories?.[0]?.repositoryUrl || "";
  console.log("=====>", workspaceId, primaryRepoUrl, formData.swarmUrl);
  useGitVisualizer({ workspaceId, repositoryUrl: primaryRepoUrl, swarmUrl: formData.swarmUrl });

  return (
    <Card className="max-w-2xl">
      <CardContent>
        <svg width="500" height="500" id="vizzy" style={{ width: "100%", height: "100%" }}></svg>
      </CardContent>
    </Card>
  );
};
