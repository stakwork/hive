"use client";

import { ConnectRepository } from "@/components/ConnectRepository";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VMConfigSection } from "@/components/vm-config";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useGithubApp } from "@/hooks/useGithubApp";
import { formatRelativeTime } from "@/lib/utils";
import { GitBranch, Github, RefreshCw, TestTube, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { GraphComponent } from "./graph";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId, slug, true);
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const processedCallback = useRef(false);
  const [isInstalling, setIsInstalling] = useState(false);

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
        window.location.href = data.data.link;
      } else {
        toast({
          title: "Installation Failed",
          description: data.message || "Failed to generate GitHub App installation link",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to install GitHub App:", error);
      toast({
        title: "Installation Failed",
        description: "An error occurred while trying to install the GitHub App",
        variant: "destructive",
      });
    } finally {
      setIsInstalling(false);
    }
  };

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
          title = "GitHub App Action";
          description = `GitHub App ${setupAction} completed`;
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
      <GraphComponent />
    </div>
  );
}
