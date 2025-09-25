"use client";

import { RepositoryCard, TestCoverageCard } from "@/components/dashboard";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { VMConfigSection } from "@/components/vm-config";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
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

  const isEnvironmentSetup = poolState === "COMPLETE";

  console.log(isEnvironmentSetup);

  // Poll ingest status if we have an ingestRefId
  useEffect(() => {
    if (codeIsSynced || !ingestRefId || !workspaceId) return;

    let isCancelled = false;

    const getIngestStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/swarm/stakgraph/ingest?id=${ingestRefId}&workspaceId=${workspaceId}`,
        );
        const { apiResult } = await res.json();
        const { data } = apiResult;

        console.log("Ingest status:", data);

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
  }, [ingestRefId, workspaceId, toast, updateWorkspace, codeIsSynced]);

  // Get the 3 most recent tasks
  const recentTasks = tasks.slice(0, 3);


  // Complete swarm setup after GitHub App installation
  const completeSwarmSetup = async () => {
    if (!workspaceId || !workspace) return;

    try {
      // Get repository URL from localStorage if available
      const repositoryUrl = localStorage.getItem("repoUrl");

      if (!repositoryUrl) {
        console.error("No repository URL found for setup");
        return;
      }

      // 1. First, create the swarm if it doesn't exist
      let swarm = workspace.swarm;
      if (!swarm?.swarmId) {
        const swarmRes = await fetch("/api/swarm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: workspaceId,
            name: workspace.slug,
            repositoryUrl: repositoryUrl,
          }),
        });

        const swarmData = await swarmRes.json();
        if (!swarmRes.ok || !swarmData.success) {
          throw new Error(swarmData.message || "Failed to create swarm");
        }

        // Update workspace reference
        await updateWorkspace(workspace);
        swarm = { swarmId: swarmData.data.swarmId };
      }

      if (!swarm?.swarmId) {
        throw new Error("Failed to get swarm ID");
      }

      // 1. Call stakgraph services endpoint
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

      // 2. Start code ingestion
      const ingestRes = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!ingestRes.ok) {
        throw new Error("Failed to start code ingestion");
      }

      // 3. Create Stakwork customer
      const customerRes = await fetch("/api/stakwork/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!customerRes.ok) {
        throw new Error("Failed to create Stakwork customer");
      }

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
  };

  // Handle GitHub App callback
  useEffect(() => {
    const setupAction = searchParams.get("github_setup_action");
    console.log('setupAction--setupAction--setupAction', setupAction)
    console.log('processedCallback.current--processedCallback.current--processedCallback.current', processedCallback.current)

    if (setupAction && !processedCallback.current) {
      processedCallback.current = true;

      let title = "";
      let description = "";
      let variant: "default" | "destructive" = "default";

      switch (setupAction) {
        case "install":
          title = "GitHub App Installed";
          description = "Successfully installed GitHub App";
          console.log('completeSwarmSetup--completeSwarmSetup--completeSwarmSetup')
          // Complete swarm setup after GitHub App installation
          completeSwarmSetup();
          break;
        case "update":
          console.log('update--update--update')
          title = "GitHub App Updated";
          description = "Successfully updated GitHub App";
          completeSwarmSetup();
          break;
        case "uninstall":
          console.log('uninstall--uninstall--uninstall')
          title = "GitHub App Uninstalled";
          description = "GitHub App has been uninstalled";
          variant = "destructive";
          break;
        default:
          console.log('default--default--default')
          title = "GitHub App Connected";
          description = "Successfully connected to GitHub";
      }

      toast({
        title,
        description,
        variant,
      });

      // Clean up URL parameter without causing re-render
      // const newUrl = new URL(window.location.href);
      // newUrl.searchParams.delete("github_setup_action");
      // const newPath = newUrl.pathname + newUrl.search;

      // // Use replace to avoid adding to history and prevent loops
      // window.history.replaceState({}, "", newPath);
    }
  }, [completeSwarmSetup, searchParams, toast]);

  console.log(workspace, slug);

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
      <Gitsee />
    </div>
  );
}
