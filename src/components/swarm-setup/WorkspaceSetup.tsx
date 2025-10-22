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
  const setupServicesDone = useRef(false);
  const lastSwarmId = useRef<string | null>(null);
  console.log('workspace', workspace);

  // Step 1: Create swarm
  const createSwarm = useCallback(async () => {
    if (!workspaceId || !slug || swarmId) return;

    try {
      setIsLoading(true);
      console.log("Creating swarm for:", repositoryUrl);

      const repoInfo = extractRepoInfoFromUrl(repositoryUrl);
      if (!repoInfo) {
        throw new Error("Invalid repository URL format");
      }

      const defaultBranch = await getRepositoryDefaultBranch(repositoryUrl, slug);
      if (!defaultBranch) {
        throw new Error("Could not determine repository default branch");
      }

      console.log('About to call /api/swarm - creating new swarm');
      const swarmRes = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          id: `repo-${Date.now()}`,
          name: repoInfo.name,
          repositoryUrl: repositoryUrl,
          branch: defaultBranch,
          status: "PENDING",
          updatedAt: new Date().toISOString(),
        }],
        swarmId: swarmData.data.id,
        swarmStatus: "ACTIVE",
      });
    } catch (error) {
      console.error("Failed to create swarm:", error);
      setError(error instanceof Error ? error.message : "Failed to create swarm");
      toast({
        title: "Swarm Creation Error",
        description: error instanceof Error ? error.message : "Failed to create swarm",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, slug, repositoryUrl, swarmId, toast, updateWorkspace]);

  // Step 2: Start code ingestion
  const startIngestion = useCallback(async () => {
    if (!workspaceId || !swarmId || ingestRefId) return;

    try {
      setIsLoading(true);
      console.log("Starting code ingestion for workspace:", workspaceId);

      const ingestRes = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!ingestRes.ok) {
        throw new Error("Failed to start code ingestion");
      }

      const ingestData = await ingestRes.json();
      updateWorkspace({ ingestRefId: ingestData.data.request_id });
    } catch (error) {
      console.error("Failed to start ingestion:", error);
      setError(error instanceof Error ? error.message : "Failed to start code ingestion");
      toast({
        title: "Ingestion Error",
        description: error instanceof Error ? error.message : "Failed to start code ingestion",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, swarmId, ingestRefId, toast, updateWorkspace]);

  // Step 3: Create Stakwork customer
  const createStakworkCustomer = useCallback(async () => {
    if (!workspaceId || hasStakworkCustomer) return;

    try {
      setIsLoading(true);
      console.log("Creating Stakwork customer for workspace:", workspaceId);

      const customerRes = await fetch("/api/stakwork/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!customerRes.ok) {
        throw new Error("Failed to create Stakwork customer");
      }
    } catch (error) {
      console.error("Failed to create customer:", error);
      setError(error instanceof Error ? error.message : "Failed to create customer");
      toast({
        title: "Customer Creation Error",
        description: error instanceof Error ? error.message : "Failed to create customer",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, hasStakworkCustomer, toast]);

  // Step 1: Create swarm when component mounts
  useEffect(() => {
    if (workspaceId && slug && !swarmId) {
      createSwarm();
    }
  }, [workspaceId, slug, swarmId, createSwarm]);

  // Step 2: Start ingestion when swarm is ready
  useEffect(() => {
    if (workspaceId && swarmId && !ingestRefId) {
      startIngestion();
    }
  }, [workspaceId, swarmId, ingestRefId, startIngestion]);

  // Step 3: Create customer when needed
  useEffect(() => {
    if (workspaceId && !hasStakworkCustomer) {
      createStakworkCustomer();
    }
  }, [workspaceId, hasStakworkCustomer, createStakworkCustomer]);

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