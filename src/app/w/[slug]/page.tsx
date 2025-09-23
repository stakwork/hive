"use client";

import { ConnectRepository } from "@/components/ConnectRepository";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { VMConfigSection } from "@/components/vm-config";
import { useGithubApp } from "@/hooks/useGithubApp";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { formatRelativeTime } from "@/lib/utils";
import { TestCoverageData } from "@/types";
import { Clock, Database, ExternalLink, GitBranch, Github, RefreshCw, TestTube } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Gitsee } from "./graph/gitsee";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId, slug, true);
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const processedCallback = useRef(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [testCoverage, setTestCoverage] = useState<TestCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
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

  // Handle GitHub App installation
  const handleGithubAppInstall = async () => {
    if (!slug) return;

    setIsInstalling(true);
    try {
      const response = await fetch("/api/github/app/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceSlug: slug }),
      });

      const data = await response.json();

      if (data.success && data.data?.link) {
        // Redirect to GitHub App installation
        // Keep spinner running during navigation
        window.location.href = data.data.link;
        // Don't set isInstalling to false - let the page navigate
      } else {
        setIsInstalling(false);
        toast({
          title: "Installation Failed",
          description: data.message || "Failed to generate GitHub App installation link",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to install GitHub App:", error);
      setIsInstalling(false);
      toast({
        title: "Installation Failed",
        description: "An error occurred while trying to install the GitHub App",
        variant: "destructive",
      });
    }
  };

  // Handle rerun ingest
  const handleRerunIngest = async () => {
    if (!workspace?.id) {
      toast({
        title: "Error",
        description: "No swarm ID found for this workspace",
        variant: "destructive",
      });
      return;
    }

    setIsIngesting(true);
    try {
      const response = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Ingest Started",
          description: "Code ingestion has been started. This may take a few minutes.",
        });
      } else {
        toast({
          title: "Ingest Failed",
          description: data.message || "Failed to start code ingestion",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to start ingest:", error);
      toast({
        title: "Ingest Failed",
        description: "An error occurred while trying to start code ingestion",
        variant: "destructive",
      });
    } finally {
      setIsIngesting(false);
    }
  };

  // Fetch test coverage if workspace has a swarm
  useEffect(() => {
    const fetchCoverage = async () => {
      if (!workspace?.swarmStatus || workspace.swarmStatus !== "ACTIVE") return;

      setCoverageLoading(true);
      try {
        const response = await fetch(`/api/tests/coverage?workspaceId=${workspaceId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            setTestCoverage(result.data);
          }
        }
      } catch (error) {
        console.error("Failed to fetch test coverage:", error);
      } finally {
        setCoverageLoading(false);
      }
    };

    fetchCoverage();
  }, [workspaceId, workspace?.swarmStatus]);

  // Handle GitHub App callback
  useEffect(() => {
    const setupAction = searchParams.get("github_setup_action");

    if (setupAction && !processedCallback.current) {
      processedCallback.current = true;

      let title = "";
      let description = "";
      let variant: "default" | "destructive" = "default";

      switch (setupAction) {
        case "install":
          title = "GitHub App Installed";
          description = "Successfully installed GitHub App";
          break;
        case "update":
          title = "GitHub App Updated";
          description = "Successfully updated GitHub App";
          break;
        case "uninstall":
          title = "GitHub App Uninstalled";
          description = "GitHub App has been uninstalled";
          variant = "destructive";
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

      // Clean up URL parameter without causing re-render
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("github_setup_action");
      const newPath = newUrl.pathname + newUrl.search;

      // Use replace to avoid adding to history and prevent loops
      window.history.replaceState({}, "", newPath);
    }
  }, [searchParams, toast]);

  console.log(workspace, slug);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Welcome to your development workspace." />

      {/* Show onboarding if needed */}
      {workspace && !workspace.isCodeGraphSetup && <ConnectRepository workspaceSlug={slug} />}

      {/* Info Cards Grid - All horizontal */}
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        {/* VM Configuration */}
        <VMConfigSection />

        {/* Repository Information Card */}
        {workspace?.repositories && workspace.repositories.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Graph Database
                </CardTitle>
                {!isGithubAppLoading &&
                  (hasGithubAppTokens ? (
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      <Github className="w-3 h-3" />
                      GitHub
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGithubAppInstall}
                      disabled={isInstalling}
                      className="text-xs h-6 px-2 bg-white text-black hover:bg-gray-100 hover:text-black dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:hover:text-black border-gray-300 dark:border-gray-300"
                    >
                      <Github className="w-3 h-3 mr-1" />
                      {isInstalling ? "Installing..." : "Link GitHub"}
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col h-full">
              <div className="flex-1"></div>
              <div className="space-y-3">
                <div className="text-sm font-medium truncate">{workspace.repositories[0].name}</div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        workspace.repositories[0].status === "SYNCED"
                          ? "default"
                          : workspace.repositories[0].status === "PENDING"
                            ? "secondary"
                            : "destructive"
                      }
                      className="text-xs"
                    >
                      {workspace.repositories[0].status}
                    </Badge>
                    <span className="text-muted-foreground">{workspace.repositories[0].branch}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <RefreshCw className="w-3 h-3" />
                    {formatRelativeTime(workspace.repositories[0].updatedAt)}
                  </div>
                </div>
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRerunIngest}
                    disabled={isIngesting}
                    className="w-full text-xs flex items-center gap-2"
                  >
                    <Database className="w-3 h-3" />
                    {isIngesting ? "Ingesting..." : "Rerun Ingest"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Test Coverage Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TestTube className="w-4 h-4" />
                Test Coverage
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {coverageLoading ? (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : testCoverage?.unit_tests !== null && testCoverage?.integration_tests !== null && testCoverage?.e2e_tests !== null ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Unit</span>
                  <span className="text-sm font-medium">
                    {testCoverage?.unit_tests.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Integration</span>
                  <span className="text-sm font-medium">
                    {testCoverage?.integration_tests?.percent.toFixed(1) || 0}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">E2E</span>
                  <span className="text-sm font-medium">
                    {testCoverage?.e2e_tests?.percent.toFixed(1) || 0}%
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No coverage data</span>
            )}
          </CardContent>
        </Card>
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
