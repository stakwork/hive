"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { extractRepoInfoFromUrl } from "@/utils/extractRepoInfoFromUrl";
import { getRepositoryDefaultBranch } from "@/utils/getRepositoryDefaultBranch";
import { useCallback, useEffect, useRef, useState } from "react";
import NetworkGraph3D from "../hive-graph-preloader";

interface WorkspaceSetupProps {
  repositoryUrl: string;
  onServicesStarted?: (started: boolean) => void;
}

export function WorkspaceSetup({ repositoryUrl, onServicesStarted }: WorkspaceSetupProps) {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ingestRefId = workspace?.ingestRefId;
  const hasStakworkCustomer = workspace?.hasKey;
  const containerFilesSetUp = workspace?.containerFilesSetUp;
  const swarmId = workspace?.swarmId;
  const setupIsDone = useRef(false);
  const setupServicesDone = useRef(false);
  const lastSwarmId = useRef<string | null>(null);
  console.log('workspace', workspace);

  const completeWorkspaceSetup = useCallback(async () => {
    if (!workspaceId || !slug) return;

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
        setIsLoading(true);
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
          swarmId: swarmData.data.id,
          swarmStatus: "ACTIVE",
        });
      }

      if (!ingestRefId) {
        setIsLoading(true);
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
        setIsLoading(true);
        const customerRes = await fetch("/api/stakwork/create-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });

        if (!customerRes.ok) {
          throw new Error("Failed to create Stakwork customer");
        }
      }

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
  }, [workspaceId, slug, repositoryUrl, swarmId, ingestRefId, hasStakworkCustomer, toast, updateWorkspace]);

  // Start setup automatically when component mounts
  useEffect(() => {
    if (!setupIsDone.current) {
      setupIsDone.current = true;
      completeWorkspaceSetup();
    }
  }, [completeWorkspaceSetup]);

  // Reset services setup flag only when swarmId actually changes to a different value
  useEffect(() => {
    if (swarmId && swarmId !== lastSwarmId.current) {
      console.log('SwarmId changed from', lastSwarmId.current, 'to', swarmId, '- resetting services setup');
      setupServicesDone.current = false;
      lastSwarmId.current = swarmId;
    }
  }, [swarmId]);

  // Handle services setup when swarmId becomes available
  useEffect(() => {
    const setupServices = async () => {
      console.log('Services setup conditions:', {
        swarmId: !!swarmId,
        containerFilesSetUp,
        workspaceId: !!workspaceId,
        setupServicesDone: setupServicesDone.current
      });

      if (!swarmId || containerFilesSetUp || !workspaceId || setupServicesDone.current) {
        console.log('Skipping services setup - conditions not met');
        return;
      }

      setupServicesDone.current = true;

      try {
        console.log('Setting up services for swarmId:', swarmId);

        // Notify that services have started
        onServicesStarted?.(true);

        const servicesRes = await fetch(
          `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
            workspaceId,
          )}&swarmId=${encodeURIComponent(swarmId)}&repo_url=${encodeURIComponent(repositoryUrl)}`,
        );

        if (!servicesRes.ok) {
          throw new Error("Failed to fetch services");
        }

        const servicesData = await servicesRes.json();
        console.log('services response:', servicesData);

        // Handle async agent processing with SSE
        if (servicesData.status === 'processing') {
          const streamUrl = `/api/swarm/stakgraph/agent-stream?request_id=${encodeURIComponent(servicesData.data.request_id)}&swarm_id=${encodeURIComponent(swarmId)}`;
          console.log('Agent processing started, using SSE stream:', streamUrl);

          // Start SSE connection but don't await it - let it run in background
          const eventSource = new EventSource(streamUrl);

          eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('SSE message:', data);
          };

          eventSource.addEventListener('completed', (event) => {
            const data = JSON.parse(event.data);
            console.log('Agent completed successfully:', data);
            eventSource.close();
            updateWorkspace({ containerFilesSetUp: true });
          });

          eventSource.addEventListener('error', (event) => {
            const data = JSON.parse((event as MessageEvent).data);
            console.error('Agent processing failed:', data);
            eventSource.close();
            // Don't fail the setup, just log the error
            console.log('Agent failed, but setup will continue with fallback if needed');
          });

          eventSource.onerror = (error) => {
            console.error('SSE connection error:', error);
            eventSource.close();
            // Don't fail the setup, just log the error
            console.log('SSE connection failed, but setup will continue');
          };

          // Don't block - continue with setup immediately
          console.log('Agent processing started in background, continuing setup...');
        } else {
          // Synchronous response (fallback mode)
          updateWorkspace({ containerFilesSetUp: true });
        }
      } catch (error) {
        console.error('Failed to setup services:', error);
        toast({
          title: "Services Setup Error",
          description: error instanceof Error ? error.message : "Failed to setup services",
          variant: "destructive",
        });
      }
    };

    setupServices();
  }, [swarmId, containerFilesSetUp, workspaceId, repositoryUrl, updateWorkspace, toast, onServicesStarted]);



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
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <PageHeader title="We are setting up your workspace" />
          <NetworkGraph3D />
        </div>
      </div>
    );
  }

  return null;
}