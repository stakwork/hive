"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getRepositoryDefaultBranch } from "@/utils/getRepositoryDefaultBranch";
import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";

interface WorkspaceSetupProps {
  repositoryUrl: string;
  onServicesStarted?: (started: boolean) => void;
}

export function WorkspaceSetup({ repositoryUrl, onServicesStarted }: WorkspaceSetupProps) {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const ingestRefId = workspace?.ingestRefId;
  const hasStakworkCustomer = workspace?.hasKey;
  const containerFilesSetUp = workspace?.containerFilesSetUp;
  const swarmId = workspace?.swarmId;
  const setupServicesDone = useRef(false);
  const lastSwarmId = useRef<string | null>(null);
  const lastWorkspaceId = useRef<string | null>(null);
  const swarmCreationStarted = useRef(false);
  const ingestionStarted = useRef(false);
  const customerCreationStarted = useRef(false);

  console.log(`WorkspaceSetup render - workspace:`, workspace);

  // Log component mount/unmount for debugging
  useEffect(() => {
    logger.debug(`WorkspaceSetup component mounted`, "swarm-setup/WorkspaceSetup");
    return () => {
      logger.debug(`WorkspaceSetup component unmounted`, "swarm-setup/WorkspaceSetup");
    };
  }, []);

  // Step 2: Start code ingestion
  const startIngestion = useCallback(async () => {
    // Primary guard: check workspace state (persists across remounts)
    if (!workspaceId || !swarmId || ingestRefId) {
      logger.debug("startIngestion skipped (state):", "swarm-setup/WorkspaceSetup", { {
        workspaceId: !!workspaceId,
        swarmId: !!swarmId,
        ingestRefId: !!ingestRefId,
      } });
      return;
    }

    // Secondary guard: prevent duplicate calls within same lifecycle
    if (ingestionStarted.current) {
      console.log("startIngestion skipped (already started)");
      return;
    }

    ingestionStarted.current = true;

    try {
      logger.debug("Starting code ingestion for workspace:", "swarm-setup/WorkspaceSetup", { workspaceId });

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
      logger.error("Failed to start ingestion:", "swarm-setup/WorkspaceSetup", { error });
      setError(error instanceof Error ? error.message : "Failed to start code ingestion");
      toast({
        title: "Ingestion Error",
        description: error instanceof Error ? error.message : "Failed to start code ingestion",
        variant: "destructive",
      });
    }
  }, [workspaceId, swarmId, ingestRefId, toast, updateWorkspace]);

  // Step 3: Create Stakwork customer
  const createStakworkCustomer = useCallback(async () => {
    // Primary guard: check workspace state (persists across remounts)
    if (!workspaceId || hasStakworkCustomer) {
      logger.debug("createStakworkCustomer skipped (state):", "swarm-setup/WorkspaceSetup", { { workspaceId: !!workspaceId, hasStakworkCustomer } });
      return;
    }

    // Secondary guard: prevent duplicate calls within same lifecycle
    if (customerCreationStarted.current) {
      console.log("createStakworkCustomer skipped (already started)");
      return;
    }

    customerCreationStarted.current = true;

    try {
      logger.debug("Creating Stakwork customer for workspace:", "swarm-setup/WorkspaceSetup", { workspaceId });

      const customerRes = await fetch("/api/stakwork/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!customerRes.ok) {
        throw new Error("Failed to create Stakwork customer");
      }

      updateWorkspace({ hasKey: true });
    } catch (error) {
      logger.error("Failed to create customer:", "swarm-setup/WorkspaceSetup", { error });
      setError(error instanceof Error ? error.message : "Failed to create customer");
      toast({
        title: "Customer Creation Error",
        description: error instanceof Error ? error.message : "Failed to create customer",
        variant: "destructive",
      });
    }
  }, [workspaceId, hasStakworkCustomer, toast]);

  // Reactive swarm creation: Only execute when conditions transition from false to true
  const shouldCreateSwarm = !!(workspace && workspaceId && slug && !swarmId);
  const prevShouldCreateSwarmRef = useRef<boolean>(false);

  useEffect(() => {
    const prevShouldCreate = prevShouldCreateSwarmRef.current;

    // Only trigger when transitioning from false to true (edge trigger)
    if (shouldCreateSwarm && !prevShouldCreate) {
      // Inline the swarm creation logic to avoid function dependency
      const performSwarmCreation = async () => {
        // Primary guard: check workspace state (persists across remounts)
        if (!workspaceId || !slug || swarmId) {
          console.log(`Swarm creation skipped (state):`, {
            workspaceId: !!workspaceId,
            slug: !!slug,
            swarmId: !!swarmId,
          });
          return;
        }

        // Secondary guard: prevent duplicate calls within same lifecycle
        if (swarmCreationStarted.current) {
          logger.debug(`Swarm creation skipped (already started)`, "swarm-setup/WorkspaceSetup");
          return;
        }

        swarmCreationStarted.current = true;

        try {
          console.log(`Creating swarm for:`, repositoryUrl);

          const { owner, repo: name } = parseGithubOwnerRepo(repositoryUrl);
          const repoInfo = { owner, name };

          const defaultBranch = await getRepositoryDefaultBranch(repositoryUrl, slug);
          if (!defaultBranch) {
            throw new Error("Could not determine repository default branch");
          }

          logger.debug(`About to call /api/swarm - creating new swarm`, "swarm-setup/WorkspaceSetup");
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

          // update data only if swarmId(external) is present
          if (swarmData.data.swarmId && swarmData.data.id) {
            updateWorkspace({
              repositories: [
                {
                  id: `repo-${Date.now()}`,
                  name: repoInfo.name,
                  repositoryUrl: repositoryUrl,
                  branch: defaultBranch,
                  status: "PENDING",
                  updatedAt: new Date().toISOString(),
                },
              ],
              swarmId: swarmData.data.id,
              swarmStatus: "ACTIVE",
            });

            fetch("/api/gitsee/trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repositoryUrl: repositoryUrl,
                workspaceId: workspaceId,
              }),
            });

          }

        } catch (error) {
          console.error(`Failed to create swarm:`, error);
          toast({
            title: "Swarm Creation Error",
            description: error instanceof Error ? error.message : "Failed to create swarm",
            variant: "destructive",
          });
        }
      };

      performSwarmCreation();
    } else if (!shouldCreateSwarm) {
      logger.debug(`❌ Conditions not met for swarm creation`, "swarm-setup/WorkspaceSetup");
    } else {
      logger.debug(`ℹ️ Conditions still true, but already handled`, "swarm-setup/WorkspaceSetup");
    }

    // Update the previous value for next comparison
    prevShouldCreateSwarmRef.current = shouldCreateSwarm;
  }, [workspace, workspaceId, slug, swarmId, repositoryUrl, toast, updateWorkspace]); // Direct dependencies only

  // Step 2: Start ingestion when swarm is ready
  useEffect(() => {
    if (workspace && workspaceId && swarmId && !ingestRefId) {
      startIngestion();
    }
  }, [workspace, workspaceId, swarmId, ingestRefId, startIngestion]);

  // Step 3: Create customer when swarm is ready
  useEffect(() => {
    if (workspace && workspaceId && swarmId && !hasStakworkCustomer) {
      createStakworkCustomer();
    }
  }, [workspace, workspaceId, swarmId, hasStakworkCustomer, createStakworkCustomer]);

  // Reset guards when workspace or conditions change
  useEffect(() => {
    if (swarmId && swarmId !== lastSwarmId.current) {
      setupServicesDone.current = false;
      lastSwarmId.current = swarmId;
    }
  }, [swarmId]);

  // Reset guards only when workspaceId actually changes (not just re-renders)
  useEffect(() => {
    if (workspaceId && workspaceId !== lastWorkspaceId.current) {
      // Only reset swarm creation guard if we don't have a swarm yet
      if (!swarmId) {
        swarmCreationStarted.current = false;
      }
      // Only reset ingestion guard if we don't have ingestion running yet
      if (!ingestRefId) {
        ingestionStarted.current = false;
      }
      // Only reset customer creation guard if we don't have a customer yet
      if (!hasStakworkCustomer) {
        customerCreationStarted.current = false;
      }
      lastWorkspaceId.current = workspaceId;
    }
  }, [workspaceId, swarmId, ingestRefId, hasStakworkCustomer]);

  // Handle services setup when swarmId becomes available
  useEffect(() => {
    const setupServices = async () => {
      logger.debug("Services setup conditions:", "swarm-setup/WorkspaceSetup", { {
        swarmId: !!swarmId,
        containerFilesSetUp,
        workspaceId: !!workspaceId,
        setupServicesDone: setupServicesDone.current,
      } });

      if (!swarmId || containerFilesSetUp || !workspaceId || setupServicesDone.current) {
        console.log("Skipping services setup - conditions not met");
        return;
      }

      // Note: containerFilesSetUp will be set to true by the API endpoints
      // (/api/swarm/stakgraph/services or /api/swarm/stakgraph/agent-stream)
      // once services and environment variables are successfully saved

      setupServicesDone.current = true;

      try {
        logger.debug("Setting up services for swarmId:", "swarm-setup/WorkspaceSetup", { swarmId });

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
        logger.debug("services response:", "swarm-setup/WorkspaceSetup", { servicesData });

        // Handle async agent processing with SSE
        if (servicesData.status === "PROCESSING") {
          const streamUrl = `/api/swarm/stakgraph/agent-stream?request_id=${encodeURIComponent(servicesData.data.request_id)}&swarm_id=${encodeURIComponent(swarmId)}`;
          logger.debug("Agent processing started, using SSE stream:", "swarm-setup/WorkspaceSetup", { streamUrl });

          // Start SSE connection but don't await it - let it run in background
          const eventSource = new EventSource(streamUrl);

          eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            logger.debug("SSE message:", "swarm-setup/WorkspaceSetup", { data });
          };

          eventSource.addEventListener("completed", (event) => {
            const data = JSON.parse(event.data);
            logger.debug("Agent completed successfully:", "swarm-setup/WorkspaceSetup", { data });
            eventSource.close();
            // Services are now set up - update frontend state to match database
            updateWorkspace({ containerFilesSetUp: true });
          });

          eventSource.addEventListener("error", (event) => {
            const data = JSON.parse((event as MessageEvent).data);
            logger.error("Agent processing failed:", "swarm-setup/WorkspaceSetup", { data });
            eventSource.close();
            // Don't fail the setup, just log the error
            console.log("Agent failed, but setup will continue with fallback if needed");
          });

          eventSource.onerror = (error) => {
            logger.error("SSE connection error:", "swarm-setup/WorkspaceSetup", { error });
            eventSource.close();
            // Don't fail the setup, just log the error
            console.log("SSE connection failed, but setup will continue");
          };

          // Don't block - continue with setup immediately
          console.log("Agent processing started in background, continuing setup...");
        } else {
          // Synchronous response (fallback mode)
          // Services are set up synchronously - update frontend state
          logger.debug("Fallback mode completed, services ready:", "swarm-setup/WorkspaceSetup", { servicesData });
          updateWorkspace({ containerFilesSetUp: true });
        }
      } catch (error) {
        logger.error("Failed to setup services:", "swarm-setup/WorkspaceSetup", { error });
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


  console.log('setup-status')
  logger.debug("swarmId", "swarm-setup/WorkspaceSetup", { swarmId });
  logger.debug("hasStakworkCustomer", "swarm-setup/WorkspaceSetup", { hasStakworkCustomer });
  logger.debug("ingestRefId", "swarm-setup/WorkspaceSetup", { ingestRefId });
  console.log('setup-status')

  // Show loading state during workspace setup
  if (!swarmId || !hasStakworkCustomer || !ingestRefId) {
    return (
      <div className="absolute inset-0 z-50 bg-background flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
          <div className="text-lg text-muted-foreground">Setting up swarm...</div>
        </div>
      </div>
    );
  }

  return null;
}
