"use client";

import { useState, useEffect } from "react";
import { Loader2, Webhook } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { WorkspaceWithAccess } from "@/types/workspace";
import type { StakgraphSettings } from "@/components/stakgraph/types";

interface RepositoryTabProps {
  workspace: WorkspaceWithAccess;
  stakgraphData: StakgraphSettings;
  stakgraphErrors: Record<string, string>;
  stakgraphLoading: boolean;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  handleRepositoryChange: (data: { repositoryUrl?: string; defaultBranch?: string }) => void;
  loadSettings: (slug: string) => Promise<void>;
}

export function RepositoryTab({
  workspace,
  stakgraphData,
  stakgraphErrors,
  stakgraphLoading,
  isSubmitting,
  setIsSubmitting,
  handleRepositoryChange,
  loadSettings,
}: RepositoryTabProps) {
  const { toast } = useToast();
  const [repositoryUrl, setRepositoryUrl] = useState(
    stakgraphData.repositoryUrl || ""
  );
  const [defaultBranch, setDefaultBranch] = useState(
    stakgraphData.defaultBranch || "main"
  );

  // Update local state when stakgraph data loads
  useEffect(() => {
    setRepositoryUrl(stakgraphData.repositoryUrl || "");
    setDefaultBranch(stakgraphData.defaultBranch || "main");
  }, [stakgraphData.repositoryUrl, stakgraphData.defaultBranch]);

  const handleEnsureWebhooks = async () => {
    try {
      if (!workspace?.id) {
        toast({
          title: "Error",
          description: "Workspace not ready",
          variant: "destructive",
        });
        return;
      }
      const res = await fetch("/api/github/webhook/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repositoryUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "INSUFFICIENT_PERMISSIONS") {
          toast({
            title: "Permission Required",
            description:
              data.message ||
              "Admin access required to manage webhooks on this repository",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: data.message || "Failed to add webhooks",
            variant: "destructive",
          });
        }
        return;
      }

      toast({
        title: "Webhooks added",
        description: "GitHub webhooks have been ensured",
      });
      if (workspace?.slug) {
        await loadSettings(workspace.slug);
      }
    } catch (error) {
      console.error("Failed to ensure webhooks", error);
      toast({
        title: "Error",
        description: "Failed to add webhooks",
        variant: "destructive",
      });
    }
  };

  const saveRepository = async () => {
    if (!workspace) return;
    setIsSubmitting(true);

    try {
      // Update stakgraph store state
      handleRepositoryChange({ repositoryUrl, defaultBranch });

      // Prepare minimal payload for repository update
      const payload = {
        name: stakgraphData.name || workspace.name, // Use workspace name as fallback
        description: stakgraphData.description || workspace.description || "",
        repositoryUrl: repositoryUrl.trim(),
        defaultBranch: defaultBranch.trim(),
        // Preserve existing swarm settings
        swarmUrl: stakgraphData.swarmUrl || "",
        swarmSecretAlias: stakgraphData.swarmSecretAlias || "",
        swarmApiKey: stakgraphData.swarmApiKey || "",
        // Preserve VM settings
        poolName: stakgraphData.poolName || "",
        poolCpu: stakgraphData.poolCpu || "2",
        poolMemory: stakgraphData.poolMemory || "4Gi",
        environmentVariables: stakgraphData.environmentVariables || [],
        services: stakgraphData.services || [],
        containerFiles: stakgraphData.containerFiles || {},
      };

      // Save to backend
      const response = await fetch(`/api/workspaces/${workspace.slug}/stakgraph`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update repository");
      }

      toast({
        title: "Success",
        description: "Repository settings updated successfully",
      });

      // Reload settings to get updated data
      await loadSettings(workspace.slug);
    } catch (error) {
      console.error("Error updating repository:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update repository",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository Configuration</CardTitle>
        <CardDescription>
          Configure the GitHub repository for this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Repository URL</label>
          <Input
            placeholder="https://github.com/owner/repository"
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            disabled={isSubmitting || stakgraphLoading}
          />
          {stakgraphErrors.repositoryUrl && (
            <p className="text-sm text-destructive">
              {stakgraphErrors.repositoryUrl}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            The GitHub repository URL for your project
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Branch</label>
          <Input
            placeholder="main"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            disabled={isSubmitting || stakgraphLoading}
          />
          {stakgraphErrors.defaultBranch && (
            <p className="text-sm text-destructive">
              {stakgraphErrors.defaultBranch}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            The branch to use for this repository
          </p>
        </div>

        <div className="flex justify-end gap-2">
          {!stakgraphData.webhookEnsured && repositoryUrl ? (
            <Button type="button" variant="default" onClick={handleEnsureWebhooks}>
              <Webhook className="mr-2 h-4 w-4" />
              Add Github Webhooks
            </Button>
          ) : null}
          <Button
            onClick={saveRepository}
            disabled={
              isSubmitting ||
              stakgraphLoading ||
              (repositoryUrl === stakgraphData.repositoryUrl &&
                defaultBranch === stakgraphData.defaultBranch)
            }
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isSubmitting ? "Updating..." : "Update Repository"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
