"use client";

import { RepositoryCard, TestCoverageCard } from "@/components/dashboard";
import { SwarmSetupLoader } from "@/components/onboarding/SwarmSetupLoader";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { VMConfigSection } from "@/components/vm-config";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { Gitsee } from "./graph/gitsee";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId, slug, true);
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const processedCallback = useRef(false);
  const ingestRefId = workspace?.ingestRefId;
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const poolState = workspace?.poolState;

  const codeIsSynced = workspace?.repositories.every((repo) => repo.status === "SYNCED");

  console.log('codeIsSynced--codeIsSynced--codeIsSynced', codeIsSynced)

  const isEnvironmentSetup = poolState === "COMPLETE";

  console.log(isEnvironmentSetup);

  // Poll ingest status if we have an ingestRefId
  useEffect(() => {
    console.log(codeIsSynced, ingestRefId, workspaceId);
    if (codeIsSynced || !ingestRefId || !workspaceId) return;

    let isCancelled = false;
    let retryAttempts = 0;
    const maxRetryAttempts = 5;

    const clearIngestRefId = async () => {
      try {
        await fetch('/api/swarm/stakgraph/ingest', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId,
            action: 'clearIngestRefId',
          }),
        });
        
        updateWorkspace({
          ingestRefId: null,
        });
        
        toast({
          title: "Ingestion Reference Cleared",
          description: "The invalid ingestion reference has been cleared. You may need to restart the ingestion process.",
          variant: "destructive",
        });
      } catch (error) {
        console.error("Failed to clear ingestRefId:", error);
      }
    };

    const handle404Error = async (source: string) => {
      retryAttempts++;
      console.log(`${source} 404 for ingestRefId (attempt ${retryAttempts}/${maxRetryAttempts})`);
      
      if (retryAttempts >= maxRetryAttempts) {
        console.log(`Max retry attempts (${maxRetryAttempts}) reached for invalid ingestRefId. Clearing reference.`);
        await clearIngestRefId();
        return true;
      }
      
      if (!isCancelled) {
        pollTimeoutRef.current = setTimeout(getIngestStatus, 10000);
      }
      return true;
    };

    const getIngestStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/swarm/stakgraph/ingest?id=${ingestRefId}&workspaceId=${workspaceId}`,
        );
        
        if (res.status === 404) {
          await handle404Error("Received");
          return;
        }

        const { apiResult } = await res.json();
        const { data } = apiResult;

        console.log("Ingest status:", data);

        if (apiResult?.status === 404) {
          await handle404Error("Stakgraph API returned");
          return;
        }

        retryAttempts = 0;

        if (data?.status === "Complete") {
          updateWorkspace({
            repositories: workspace?.repositories.map((repo) => ({
              ...repo,
              status: "SYNCED",
            })),
          });

          return; // Stop polling
        } else if (data?.status === "Failed") {
          console.log('Ingestion failed');
          toast({
            title: "Code Ingestion Failed",
            description: "There was an error ingesting your codebase. Please try again.",
            variant: "destructive",
          });
          return; 
        } else {
          // Continue polling if still in progress
          pollTimeoutRef.current = setTimeout(getIngestStatus, 5000);
        }
      } catch (error) {
        console.error("Failed to get ingest status:", error);
        retryAttempts++;

        if (retryAttempts >= maxRetryAttempts) {
          console.log(`Max retry attempts (${maxRetryAttempts}) reached due to repeated errors.`);
          toast({
            title: "Ingestion Status Check Failed",
            description: "Unable to check ingestion status after multiple attempts. Please try refreshing the page.",
            variant: "destructive",
          });
          return; 
        }

        // Retry after a longer delay on error
        if (!isCancelled) {
          pollTimeoutRef.current = setTimeout(getIngestStatus, 10000);
        }
      }
    };

    getIngestStatus();

    return () => {
      isCancelled = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [ingestRefId, workspaceId, toast, updateWorkspace, codeIsSynced]);

  // Get the 3 most recent tasks
  const recentTasks = tasks.slice(0, 3);

  // Helper function to extract repository info from URL
  const extractRepoInfoFromUrl = (url: string) => {
    try {
      // Handle various GitHub URL formats
      const githubMatch = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
      if (githubMatch) {
        return {
          owner: githubMatch[1],
          name: githubMatch[2]
        };
      }
      return null;
    } catch (error) {
      console.error("Error extracting repo info from URL:", error);
      return null;
    }
  };

  // Function to fetch repository default branch
  const getRepositoryDefaultBranch = async (repositoryUrl: string): Promise<string> => {
    try {
      // Extract owner/repo from URL
      const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
      if (!githubMatch) {
        console.warn("Invalid repository URL format, defaulting to 'main' branch");
        return "main";
      }

      const [, owner, repo] = githubMatch;

      // Try to fetch repository info from GitHub API via our proxy
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.ok) {
        const repoData = await response.json();
        if (repoData.default_branch) {
          return repoData.default_branch;
        }
      }

      console.warn("Could not fetch repository info, defaulting to 'main' branch");
      return "main";
    } catch (error) {
      console.error("Error fetching repository default branch:", error);
      return "main";
    }
  };

  // Complete swarm setup after GitHub App installation
  const completeSwarmSetup = useCallback(async () => {
    if (!workspaceId || !workspace) return;

    try {
      // Get repository URL from localStorage if available
      const repositoryUrl = localStorage.getItem("repoUrl");

      if (!repositoryUrl) {
        console.error("No repository URL found for setup");
        return;
      }

      // Extract repository info from URL
      const repoInfo = extractRepoInfoFromUrl(repositoryUrl);

      if (!repoInfo) {
        console.error("Could not extract repository info from URL:", repositoryUrl);
        toast({
          title: "Setup Error",
          description: "Invalid repository URL format",
          variant: "destructive",
        });
        return;
      }

      // Fetch repository default branch
      const defaultBranch = await getRepositoryDefaultBranch(repositoryUrl);
      console.log(`Repository default branch: ${defaultBranch}`);

      if (!defaultBranch || defaultBranch === "main") {
        console.warn("Using fallback default branch 'main'");
      }

      // Check if workspace already has a swarm (via API call since swarm isn't in workspace type)
      let swarm: { swarmId: string } | null = null;

      // Try to get swarm info from API
      try {
        const swarmResponse = await fetch(`/api/workspaces/${workspaceId}/swarm`);
        if (swarmResponse.ok) {
          const swarmData = await swarmResponse.json();
          if (swarmData.success && swarmData.data?.swarmId) {
            swarm = { swarmId: swarmData.data.swarmId };
          }
        }
      } catch (error) {
        console.log("Could not fetch existing swarm info:", error);
      }

      if (!swarm?.swarmId) {
        console.log('Creating swarm with:', {
          workspaceId: workspaceId,
          name: workspace.slug,
          repositoryName: repoInfo.name,
          repositoryUrl: repositoryUrl,
          repositoryDefaultBranch: defaultBranch,
        });

        const swarmRes = await fetch("/api/swarm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: workspaceId,
            name: workspace.slug,
            repositoryName: repoInfo.name,
            repositoryUrl: repositoryUrl,
            repositoryDefaultBranch: defaultBranch,
          }),
        });

        const swarmData = await swarmRes.json();
        if (!swarmRes.ok || !swarmData.success) {
          throw new Error(swarmData.message || "Failed to create swarm");
        }

        // Update workspace reference
        await updateWorkspace(workspace);
        swarm = { swarmId: swarmData.data.swarmId };

        // Immediately update workspace with repository data after swarm creation
        updateWorkspace({
          repositories: [{
            id: `repo-${Date.now()}`, // temporary ID
            name: repoInfo.name,
            repositoryUrl: repositoryUrl,
            branch: defaultBranch,
            status: "PENDING", // Initially pending, will become SYNCED after ingestion
            updatedAt: new Date().toISOString(),
          }],
          swarmStatus: "ACTIVE",
        });
      }

      if (!swarm?.swarmId) {
        throw new Error("Failed to get swarm ID");
      }

      const ingestRes = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!ingestRes.ok) {
        throw new Error("Failed to start code ingestion");
      }

      // Create Stakwork customer
      const customerRes = await fetch("/api/stakwork/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!customerRes.ok) {
        throw new Error("Failed to create Stakwork customer");
      }

      // Call stakgraph services endpoint
      const servicesRes = await fetch(
        `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
          workspaceId,
        )}&swarmId=${encodeURIComponent(swarm.swarmId)}&repo_url=${encodeURIComponent(repositoryUrl)}`,
      );

      if (!servicesRes.ok) {
        throw new Error("Failed to fetch services");
      }

      const servicesData = await servicesRes.json();
      console.log('services', servicesData);

      toast({
        title: "Workspace Setup Complete",
        description: "Your workspace is now being configured. Code ingestion has started.",
        variant: "default",
      });

    } catch (error) {
      console.error("Failed to complete swarm setup:", error);
      toast({
        title: "Setup Error",
        description: error instanceof Error ? error.message : "Failed to complete workspace setup",
        variant: "destructive",
      });
    }
  }, [workspaceId, workspace, extractRepoInfoFromUrl, getRepositoryDefaultBranch, updateWorkspace, toast]);

  // Handle GitHub App callback
  useEffect(() => {
    const setupAction = searchParams.get("github_setup_action");
    console.log('setupAction', setupAction)

    if (setupAction && !processedCallback.current) {
      processedCallback.current = true;

      let title = "";
      let description = "";
      let variant: "default" | "destructive" = "default";

      switch (setupAction) {
        case "existing_installation":
          title = "GitHub App Ready";
          description = "Using existing GitHub App installation";
          // Complete swarm setup since GitHub App is already configured
          completeSwarmSetup();
          break;
        case "install":
          title = "GitHub App Installed";
          description = "Successfully installed GitHub App. Setting up workspace...";
          // Complete swarm setup after GitHub App installation
          completeSwarmSetup();
          break;
        case "update":
          title = "GitHub App Updated";
          description = "Successfully updated GitHub App. Setting up workspace...";
          // Complete swarm setup after GitHub App update
          completeSwarmSetup();
          break;
        case "uninstall":
          title = "GitHub App Uninstalled";
          description = "GitHub App has been uninstalled";
          variant = "destructive";
          break;
        case "connected":
          title = "GitHub App Connected";
          description = "Successfully connected to GitHub. Setting up workspace...";
          // Complete swarm setup after GitHub App connection
          completeSwarmSetup();
          break;
        default:
          title = "GitHub App Connected";
          description = "Successfully connected to GitHub";
      }

      toast({
        title,
        description,
        variant,
      });

      // Clean up URL parameters without causing re-render
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("github_setup_action");
      newUrl.searchParams.delete("repository_access");
      const newPath = newUrl.pathname + newUrl.search;

      // Use replace to avoid adding to history and prevent loops
      window.history.replaceState({}, "", newPath);
    }
  }, [searchParams, toast, completeSwarmSetup]);

  console.log(workspace, slug);

  // Determine if swarm is ready - repositories exist (swarm is created and setup is complete)
  const isSwarmReady = workspace &&
    workspace.repositories &&
    workspace.repositories.length > 0;

  // Show full-page loading if workspace exists but swarm is not ready yet
  const shouldShowSwarmLoader = workspace && !isSwarmReady;

  if (shouldShowSwarmLoader) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Welcome to your development workspace." />
        <SwarmSetupLoader />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Welcome to your development workspace." />


      {/* Info Cards Grid - All horizontal */}
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <VMConfigSection />
        <RepositoryCard />
        <TestCoverageCard />
      </div>

      {/* Recent Tasks Section */}
      {workspace &&
        workspace.isCodeGraphSetup &&
        (recentTasks.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Recent Tasks</CardTitle>
              <CardDescription>Your most recently created tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <TaskCard key={task.id} task={task} workspaceSlug={slug} />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState workspaceSlug={slug} />
        ))}

      {/* Only render Gitsee when swarm is ready */}
      {isSwarmReady && <Gitsee />}
    </div>
  );
}
