"use client";

import { useState, useEffect } from "react";
import { Loader2, Key } from "lucide-react";
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

interface InfrastructureTabProps {
  workspace: WorkspaceWithAccess;
  stakgraphData: StakgraphSettings;
  stakgraphErrors: Record<string, string>;
  stakgraphLoading: boolean;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  handleSwarmChange: (data: {
    swarmUrl?: string;
    swarmSecretAlias?: string;
    swarmApiKey?: string;
  }) => void;
  loadSettings: (slug: string) => Promise<void>;
}

export function InfrastructureTab({
  workspace,
  stakgraphData,
  stakgraphErrors,
  stakgraphLoading,
  isSubmitting,
  setIsSubmitting,
  handleSwarmChange,
  loadSettings,
}: InfrastructureTabProps) {
  const { toast } = useToast();
  const [swarmUrl, setSwarmUrl] = useState(stakgraphData.swarmUrl || "");
  const [swarmSecretAlias, setSwarmSecretAlias] = useState(
    stakgraphData.swarmSecretAlias || ""
  );
  const [swarmApiKey, setSwarmApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  // Update local state when stakgraph data loads
  useEffect(() => {
    setSwarmUrl(stakgraphData.swarmUrl || "");
    setSwarmSecretAlias(stakgraphData.swarmSecretAlias || "");
    // Don't set API key from stakgraph data as it's write-only
  }, [stakgraphData.swarmUrl, stakgraphData.swarmSecretAlias]);

  const saveInfrastructure = async () => {
    if (!workspace) return;
    setIsSubmitting(true);

    try {
      // Update stakgraph store state
      handleSwarmChange({ swarmUrl, swarmSecretAlias, swarmApiKey });

      // Prepare minimal payload for infrastructure update
      const payload = {
        name: stakgraphData.name || workspace.name, // Use workspace name as fallback
        description: stakgraphData.description || workspace.description || "",
        // Preserve repository setting
        repositoryUrl: stakgraphData.repositoryUrl || "",
        // Update swarm settings
        swarmUrl: swarmUrl.trim(),
        swarmSecretAlias: swarmSecretAlias.trim(),
        swarmApiKey: swarmApiKey ? swarmApiKey.trim() : "",
        // Preserve VM settings
        poolName: stakgraphData.poolName || "",
        poolCpu: stakgraphData.poolCpu || "2",
        poolMemory: stakgraphData.poolMemory || "4Gi",
        environmentVariables: stakgraphData.environmentVariables || [],
        services: stakgraphData.services || [],
        containerFiles: stakgraphData.containerFiles || {},
      };

      // Save to backend
      const response = await fetch(
        `/api/workspaces/${workspace.slug}/stakgraph`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update infrastructure");
      }

      toast({
        title: "Success",
        description: "Infrastructure settings updated successfully",
      });

      // Reload settings to get updated data
      await loadSettings(workspace.slug);
      // Reset API key touched state after successful save
      setApiKeyTouched(false);
      setSwarmApiKey("");
    } catch (error) {
      console.error("Error updating infrastructure:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update infrastructure",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Graph Database Configuration</CardTitle>
        <CardDescription>
          Configure Swarm connection for your Graph database infrastructure
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Swarm URL</label>
          <Input
            placeholder="https://your-swarm-domain.com"
            value={swarmUrl}
            onChange={(e) => setSwarmUrl(e.target.value)}
            disabled={isSubmitting || stakgraphLoading}
          />
          {stakgraphErrors.swarmUrl && (
            <p className="text-sm text-destructive">
              {stakgraphErrors.swarmUrl}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The base URL of your Swarm instance
          </p>
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}
          >
            {showApiKey ? "Swarm Api Key" : "Swarm Secret Alias"}
          </label>
          <div className="relative">
            <Input
              key={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}
              id={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}
              type={showApiKey ? "password" : "text"}
              placeholder={
                showApiKey
                  ? "Enter your actual API key to update"
                  : "e.g. {{SWARM_123456_API_KEY}}"
              }
              value={
                (() => {
                  const showVisualDots =
                    showApiKey &&
                    !apiKeyTouched &&
                    (!swarmApiKey || swarmApiKey === "");
                  return showVisualDots
                    ? "••••••••••••••••"
                    : showApiKey
                      ? swarmApiKey || ""
                      : swarmSecretAlias || "";
                })()
              }
              onChange={(e) => {
                if (showApiKey) {
                  setSwarmApiKey(e.target.value);
                  setApiKeyTouched(true);
                } else {
                  setSwarmSecretAlias(e.target.value);
                }
              }}
              onFocus={() => {
                if (showApiKey) {
                  setApiKeyTouched(true);
                }
              }}
              disabled={isSubmitting || stakgraphLoading}
              className={
                stakgraphErrors.swarmSecretAlias || stakgraphErrors.swarmApiKey
                  ? "border-destructive pr-10"
                  : "pr-10"
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
              onClick={() => {
                setShowApiKey(!showApiKey);
                if (!showApiKey) {
                  setApiKeyTouched(false);
                }
              }}
            >
              <Key className="h-4 w-4" />
            </Button>
          </div>
          {(stakgraphErrors.swarmSecretAlias || stakgraphErrors.swarmApiKey) && (
            <p className="text-sm text-destructive">
              {showApiKey
                ? stakgraphErrors.swarmApiKey
                : stakgraphErrors.swarmSecretAlias}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {showApiKey
              ? "Your actual API key for authenticating with the Swarm service (write-only)"
              : "The secret alias reference for your Swarm API key"}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={saveInfrastructure}
            disabled={
              isSubmitting ||
              stakgraphLoading ||
              (swarmUrl === stakgraphData.swarmUrl &&
                swarmSecretAlias === stakgraphData.swarmSecretAlias &&
                !apiKeyTouched)
            }
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isSubmitting ? "Updating..." : "Update Infrastructure"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
