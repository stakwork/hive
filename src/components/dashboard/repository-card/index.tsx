"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useGithubApp } from "@/hooks/useGithubApp";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatRelativeTime } from "@/lib/utils";
import { ExternalLink, GitBranch, Github, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

export function RepositoryCard() {

  const { workspace, slug } = useWorkspace();

  console.log('slug-is-here', slug);
  console.log('workspace-slug-is-here', workspace?.slug);
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp(slug);
  console.log('hasGithubAppTokens-is-here', hasGithubAppTokens);
  console.log('isGithubAppLoading-is-here', isGithubAppLoading);
  const { toast } = useToast();
  const [isInstalling, setIsInstalling] = useState(false);
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

  // Show loading animation if workspace exists but repositories are not ready yet
  // This happens during swarm setup and code ingestion
  const isSwarmBeingSetup = workspace && (!workspace?.repositories || workspace.repositories.length === 0) && !isGithubAppLoading;

  if (isSwarmBeingSetup) {
    return (
      <Card data-testid="repository-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Graph Database
            </CardTitle>
            <Badge variant="secondary" className="text-xs flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Setting up
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col h-full">
          <div className="flex-1"></div>
          <div className="space-y-3">
            {/* Animated placeholder icon similar to project-name-setup */}
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 48 48"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mx-auto mb-3"
                >
                  <line
                    x1="24"
                    y1="8"
                    x2="8"
                    y2="24"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-blue-500"
                  />
                  <line
                    x1="24"
                    y1="8"
                    x2="40"
                    y2="24"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-blue-500"
                  />
                  <line
                    x1="8"
                    y1="24"
                    x2="24"
                    y2="40"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-blue-500"
                  />
                  <line
                    x1="40"
                    y1="24"
                    x2="24"
                    y2="40"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-blue-500"
                  />
                  <circle cx="24" cy="8" r="4" fill="currentColor" className="text-blue-600">
                    <animate
                      attributeName="r"
                      values="4;6;4"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle cx="8" cy="24" r="3" fill="currentColor" className="text-blue-500">
                    <animate
                      attributeName="r"
                      values="3;5;3"
                      dur="1.2s"
                      begin="0.3s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle cx="40" cy="24" r="3" fill="currentColor" className="text-blue-500">
                    <animate
                      attributeName="r"
                      values="3;5;3"
                      dur="1.2s"
                      begin="0.6s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle cx="24" cy="40" r="3" fill="currentColor" className="text-blue-400">
                    <animate
                      attributeName="r"
                      values="3;5;3"
                      dur="1.2s"
                      begin="0.9s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </svg>
                <p className="text-sm text-muted-foreground">Setting up code graph...</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // If no workspace at all, don't render
  if (!workspace?.repositories || workspace.repositories.length === 0) {
    return null;
  }

  const repository = workspace.repositories[0];

  return (
    <Card data-testid="repository-card">
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
          <div className="text-sm font-medium truncate">{repository.name}</div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  repository.status === "SYNCED"
                    ? "default"
                    : repository.status === "PENDING"
                      ? "secondary"
                      : "destructive"
                }
                className="text-xs"
              >
                {repository.status}
              </Badge>
              <span className="text-muted-foreground">{repository.branch}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
              {formatRelativeTime(repository.updatedAt)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}