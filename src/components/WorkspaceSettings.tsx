"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Edit3, Loader2, GitBranch, Server, Key } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { updateWorkspaceSchema, UpdateWorkspaceInput } from "@/lib/schemas/workspace";
import { useToast } from "@/components/ui/use-toast";
import { useStakgraphStore } from "@/stores/useStakgraphStore";

export function WorkspaceSettings() {
  const { workspace, refreshCurrentWorkspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const { toast } = useToast();

  // Stakgraph store for repository and infrastructure data
  const {
    formData: stakgraphData,
    loadSettings,
    handleRepositoryChange,
    handleSwarmChange,
    errors: stakgraphErrors,
    loading: stakgraphLoading,
    initialLoading: stakgraphInitialLoading,
  } = useStakgraphStore();

  // Load stakgraph settings when workspace changes
  useEffect(() => {
    if (workspace?.slug) {
      loadSettings(workspace.slug);
    }
  }, [workspace?.slug, loadSettings]);

  const form = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: {
      name: workspace?.name || "",
      slug: workspace?.slug || "",
      description: workspace?.description || "",
    },
  });

  // Repository form
  const [repositoryUrl, setRepositoryUrl] = useState(stakgraphData.repositoryUrl || "");

  // Infrastructure form
  const [swarmUrl, setSwarmUrl] = useState(stakgraphData.swarmUrl || "");
  const [swarmSecretAlias, setSwarmSecretAlias] = useState(stakgraphData.swarmSecretAlias || "");
  const [swarmApiKey, setSwarmApiKey] = useState(stakgraphData.swarmApiKey || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  // Update local state when stakgraph data loads
  useEffect(() => {
    setRepositoryUrl(stakgraphData.repositoryUrl || "");
    setSwarmUrl(stakgraphData.swarmUrl || "");
    setSwarmSecretAlias(stakgraphData.swarmSecretAlias || "");
    // Don't set API key from stakgraph data as it's write-only
    if (!swarmApiKey) {
      setSwarmApiKey("");
    }
  }, [stakgraphData]);

  const onSubmit = async (data: UpdateWorkspaceInput) => {
    if (!workspace) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update workspace");
      }

      toast({
        title: "Success",
        description: "Workspace updated successfully",
      });

      // If slug changed, redirect to new URL
      if (result.slugChanged) {
        const currentPath = window.location.pathname.replace(`/w/${workspace.slug}`, "");
        router.push(`/w/${result.slugChanged}${currentPath}`);
      } else {
        // Just refresh the workspace data
        await refreshCurrentWorkspace();
      }
    } catch (error) {
      console.error("Error updating workspace:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update workspace",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveRepository = async () => {
    if (!workspace) return;
    setIsSubmitting(true);

    try {
      // Update stakgraph store state
      handleRepositoryChange({ repositoryUrl });

      // Prepare minimal payload for repository update
      const payload = {
        name: stakgraphData.name || workspace.name, // Use workspace name as fallback
        description: stakgraphData.description || workspace.description || "",
        repositoryUrl: repositoryUrl.trim(),
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
        description: error instanceof Error ? error.message : "Failed to update repository",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
      const response = await fetch(`/api/workspaces/${workspace.slug}/stakgraph`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

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
    } catch (error) {
      console.error("Error updating infrastructure:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update infrastructure",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workspace || !canAdmin) {
    return null;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="general" className="flex items-center gap-2">
          <Edit3 className="w-4 h-4" />
          General
        </TabsTrigger>
        <TabsTrigger value="repository" className="flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Repository
        </TabsTrigger>
        <TabsTrigger value="infrastructure" className="flex items-center gap-2">
          <Server className="w-4 h-4" />
          Graph DB
        </TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <Card>
          <CardHeader>
            <CardTitle>Workspace Details</CardTitle>
            <CardDescription>
              Update your workspace name, URL, and description
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="The display name for your workspace"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace URL</FormLabel>
                      <FormControl>
                        <div className="flex items-center">
                          <span className="text-sm text-muted-foreground mr-1">
                            /w/
                          </span>
                          <Input
                            placeholder="lowercase, use hyphens for spaces"
                            {...field}
                            disabled={isSubmitting}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="A brief description of your workspace"
                          className="resize-none"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={isSubmitting || !form.formState.isDirty}
                  >
                    {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {isSubmitting ? "Updating..." : "Update Workspace"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="repository">
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
                <p className="text-sm text-destructive">{stakgraphErrors.repositoryUrl}</p>
              )}
              <p className="text-sm text-muted-foreground">
                The GitHub repository URL for your project
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={saveRepository}
                disabled={isSubmitting || stakgraphLoading || repositoryUrl === stakgraphData.repositoryUrl}
              >
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isSubmitting ? "Updating..." : "Update Repository"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="infrastructure">
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
                <p className="text-sm text-destructive">{stakgraphErrors.swarmUrl}</p>
              )}
              <p className="text-xs text-muted-foreground">
                The base URL of your Swarm instance
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}>
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
                      const showVisualDots = showApiKey && !apiKeyTouched && (!swarmApiKey || swarmApiKey === "");
                      return showVisualDots ? "••••••••••••••••" : (showApiKey ? (swarmApiKey || "") : (swarmSecretAlias || ""));
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
                  {showApiKey ? stakgraphErrors.swarmApiKey : stakgraphErrors.swarmSecretAlias}
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
                disabled={isSubmitting || stakgraphLoading ||
                  (swarmUrl === stakgraphData.swarmUrl &&
                   swarmSecretAlias === stakgraphData.swarmSecretAlias &&
                   swarmApiKey === stakgraphData.swarmApiKey)}
              >
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isSubmitting ? "Updating..." : "Update Infrastructure"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}