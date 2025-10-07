"use client";

import { Gitsee } from "@/app/w/[slug]/graph/gitsee";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { extractRepoInfoFromUrl } from "@/utils/extractRepoInfoFromUrl";
import { getRepositoryDefaultBranch } from "@/utils/getRepositoryDefaultBranch";
import { useCallback, useEffect, useRef, useState } from "react";

interface WorkspaceSetupProps {
  repositoryUrl: string;
}

export function WorkspaceSetup({ repositoryUrl }: WorkspaceSetupProps) {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ingestRefId = workspace?.ingestRefId;
  const hasStakworkCustomer = workspace?.hasKey;
  const containerFilesSetup = workspace?.containerFilesSetup;
  const swarmId = workspace?.swarmId;
  const setupIsDone = useRef(false);
  console.log('workspace', workspace);

  const completeWorkspaceSetup = useCallback(async () => {
    if (!workspaceId || !slug) return;

    setIsLoading(true);

    try {
      // Access check is already done, so proceed directly
      console.log("Proceeding with workspace setup for:", repositoryUrl);


      // Extract repository info from URL
      const repoInfo = extractRepoInfoFromUrl(repositoryUrl);

      if (!repoInfo) {
        throw new Error("Invalid repository URL format");
      }

      // Fetch repository default branch
      const defaultBranch = await getRepositoryDefaultBranch(repositoryUrl, slug);

      if (!defaultBranch) {
        throw new Error("Could not determine repository default branch - setup cannot continue");
      }

      if (!swarmId) {
        const swarmRes = await fetch("/api/swarm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: workspaceId,
            repositoryName: repoInfo.name,
            repositoryUrl: repositoryUrl,
            repositoryDefaultBranch: defaultBranch,
          }),
        });

        const swarmData = await swarmRes.json();
        if (!swarmRes.ok || !swarmData.success) {
          throw new Error(swarmData.message || "Failed to create swarm");
        }

        updateWorkspace({
          repositories: [{
            id: `repo-${Date.now()}`, // temporary ID
            name: repoInfo.name,
            repositoryUrl: repositoryUrl,
            branch: defaultBranch,
            status: "PENDING", // Initially pending, will become SYNCED after ingestion
            updatedAt: new Date().toISOString(),
          }],
          swarmId: swarmData.data.swarmId,
          swarmStatus: "ACTIVE",
        });
      }

      if (!ingestRefId) {

        const ingestRes = await fetch("/api/swarm/stakgraph/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });


        console.log('ingestRes', ingestRes);
        if (!ingestRes.ok) {
          throw new Error("Failed to start code ingestion");
        }

        const ingestData = await ingestRes.json();

        console.log('ingestData', ingestData);
        updateWorkspace({ ingestRefId: ingestData.data.request_id });
      }

      if (!hasStakworkCustomer) {
        const customerRes = await fetch("/api/stakwork/create-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });

        if (!customerRes.ok) {
          throw new Error("Failed to create Stakwork customer");
        }
      }




      if (!containerFilesSetup && swarmId) {

        const servicesRes = await fetch(
          `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
            workspaceId,
          )}&swarmId=${encodeURIComponent(swarmId)}&repo_url=${encodeURIComponent(repositoryUrl)}`,
        );

        if (!servicesRes.ok) {
          throw new Error("Failed to fetch services");
        }

        const servicesData = await servicesRes.json();
        console.log('services', servicesData);

        updateWorkspace({ containerFilesSetup: true });
      }

      // Call stakgraph services endpoint

      toast({
        title: "Workspace Setup Complete",
        description: "Your workspace is now being configured. Code ingestion has started.",
        variant: "default",
      });


    } catch (error) {
      console.error("Failed to complete workspace setup:", error);
      setError(error instanceof Error ? error.message : "Failed to complete workspace setup");
      toast({
        title: "Setup Error",
        description: error instanceof Error ? error.message : "Failed to complete workspace setup",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, slug, repositoryUrl, swarmId, ingestRefId, hasStakworkCustomer, containerFilesSetup, toast, updateWorkspace]);

  // Start setup automatically when component mounts
  useEffect(() => {

    if (!setupIsDone.current) {
      setupIsDone.current = true;
      completeWorkspaceSetup();
    }
  }, [completeWorkspaceSetup]);



  // Show error state first, before checking completion
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <PageHeader title="Setup Error" />
          <p className="text-sm text-muted-foreground mt-4">{error}</p>
        </div>
      </div>
    );
  }


  // Show loading state during workspace setup
  if (isLoading) {
    const isSwarmReady = (workspace?.swarmId);

    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <PageHeader title="We are setting up your workspace" />
          {isSwarmReady ? <Gitsee /> : (
            <Card className="max-w-2xl">
              <CardContent>
                <div className="flex flex-col items-center justify-center space-y-4" style={{ width: "500px", height: "500px" }}>
                  <div className="w-16 h-16 bg-[#16a34a] rounded-full animate-pulse"></div>
                  {workspace?.repositories?.[0]?.name && (
                    <p className="text-lg font-medium text-muted-foreground">
                      {workspace.repositories[0].name}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return null;
}