import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import Repository3DGraph from "@/components/knowledge-graph/Universe/Graph/GitSee";
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

  return (
    <Card className="w-full h-[600px]">
      <CardContent className="p-0 h-full">
        <div className="w-full h-full rounded-lg overflow-hidden">
          <Repository3DGraph
            repositoryUrl={primaryRepoUrl}
            workspaceId={workspaceId || undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
};
