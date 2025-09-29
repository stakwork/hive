"use client";

import { RepositoryCard, TestCoverageCard } from "@/components/dashboard";
import { VMConfigSection } from "@/components/pool-status";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gitsee } from "./graph/gitsee";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId, slug, true);
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const processedCallback = useRef(false);
  const ingestRefId = workspace?.ingestRefId;
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [shouldShowSwarmLoader, setShouldShowSwarmLoader] = useState(false);
  const [ingestError, setIngestError] = useState(false);

  const poolState = workspace?.poolState;

  const codeIsSynced = workspace?.repositories.every((repo) => repo.status === "SYNCED");

  console.log('codeIsSynced--codeIsSynced--codeIsSynced', codeIsSynced)

  const isEnvironmentSetup = poolState === "COMPLETE";

  console.log(isEnvironmentSetup);

  // Poll ingest status if we have an ingestRefId
  useEffect(() => {

    if (codeIsSynced || !ingestRefId || !workspaceId || ingestError) return;

    let isCancelled = false;

    const getIngestStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/swarm/stakgraph/ingest?id=${ingestRefId}&workspaceId=${workspaceId}`,
        );
        const { apiResult } = await res.json();
        const { data } = apiResult;

        console.log(apiResult)

        if (apiResult.status === 500) {
          setIngestError(true);
          return;
        }


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
        } else {
          // Continue polling if still in progress
          pollTimeoutRef.current = setTimeout(getIngestStatus, 5000);
        }
      } catch (error) {
        console.error("Failed to get ingest status:", error);
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
  }, [ingestRefId, workspaceId, toast, updateWorkspace, codeIsSynced, ingestError, workspace?.repositories]);

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

    setShouldShowSwarmLoader(true);

    try {
      // Get repository URL from localStorage if available
      const repositoryUrl = localStorage.getItem("repoUrl");

      localStorage.removeItem("repoUrl");

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
    } finally {
      setShouldShowSwarmLoader(false);
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


  if (shouldShowSwarmLoader) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <PageHeader title="Welcome to your development workspace" />
          {isSwarmReady ? <Gitsee /> : (
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-[#16a34a] rounded-full animate-pulse"></div>
              {workspace?.repositories?.[0]?.name && (
                <p className="text-lg font-medium text-muted-foreground">
                  {workspace.repositories[0].name}
                </p>
              )}
            </div>
          )}
        </div>
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
