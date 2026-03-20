"use client";

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { WorkspaceMembers } from "@/components/workspace/WorkspaceMembers";
import { VMConfigSection } from "@/components/pool-status";
import { RerunIngest } from "@/components/RerunIngest";
import { Neo4jConfigSettings } from "@/components/settings/Neo4jConfigSettings";
import { VercelIntegrationSettings } from "@/components/settings/VercelIntegrationSettings";
import { SphinxIntegrationSettings } from "@/components/settings/SphinxIntegrationSettings";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";
import { NodeTypeOrderSettings } from "@/components/settings/NodeTypeOrderSettings";
import { DeleteWorkspace } from "@/components/DeleteWorkspace";
import { EnvironmentForm, ProjectInfoForm, RepositoryForm, ServicesForm, SwarmForm } from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { PodRepairSection } from "@/components/pod-repair";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";
import { Loader2, Save, Webhook } from "lucide-react";

const VALID_TABS = ["general", "pool", "infrastructure", "integrations", "developer"] as const;
type TabValue = (typeof VALID_TABS)[number];

interface SettingsTabsProps {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  isOwner: boolean;
}

export function SettingsTabs({ workspaceId, workspaceName, workspaceSlug, isOwner }: SettingsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id, refreshCurrentWorkspace } = useWorkspace();

  const {
    formData,
    errors,
    loading,
    initialLoading,
    saved,
    repoValidationErrors,
    loadSettings,
    saveSettings,
    setRepoValidationErrors,
    handleProjectInfoChange,
    handleRepositoryChange,
    handleSwarmChange,
    handleEnvironmentChange,
    handleEnvVarsChange,
    handleServicesChange,
    handleFileChange,
  } = useStakgraphStore();

  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab: TabValue = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "general";

  useEffect(() => {
    if (activeTab === "pool" && workspaceSlug) {
      loadSettings(workspaceSlug);
    }
  }, [activeTab, workspaceSlug, loadSettings]);

  const handleTabChange = (value: string) => {
    router.replace(`?tab=${value}`, { scroll: false });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceSlug) return;
    await saveSettings(workspaceSlug);
    refreshCurrentWorkspace();
  };

  const handleEnsureWebhooks = async () => {
    try {
      if (!id) {
        toast.error("Error", { description: "Workspace not ready" });
        return;
      }

      const primaryRepo = formData.repositories?.[0];
      if (!primaryRepo?.repositoryUrl) {
        toast.error("Error", { description: "No repository configured" });
        return;
      }

      const res = await fetch("/api/github/webhook/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: id,
          repositoryUrl: primaryRepo.repositoryUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "INSUFFICIENT_PERMISSIONS") {
          toast.error("Permission Required", {
            description: data.message || "Admin access required to manage webhooks on this repository",
          });
        } else {
          toast.error("Error", { description: data.message || "Failed to add webhooks" });
        }
        return;
      }

      toast("Webhooks added", { description: "GitHub webhooks have been ensured" });
      await loadSettings(workspaceSlug);
    } catch (error) {
      console.error("Failed to ensure webhooks", error);
      toast.error("Error", { description: "Failed to add webhooks" });
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="pool">Pool</TabsTrigger>
        <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="developer">Developer</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <div className="max-w-2xl space-y-6 mt-6">
          <WorkspaceSettings />
          <WorkspaceMembers canAdmin />
          {isOwner && <DeleteWorkspace workspaceSlug={workspaceSlug} workspaceName={workspaceName} />}
        </div>
      </TabsContent>

      <TabsContent value="pool">
        <div className="flex flex-col lg:flex-row gap-6 items-start mt-6">
          <div className="w-full lg:max-w-2xl space-y-6">
            <VMConfigSection />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Pool Settings</CardTitle>
                <div className="flex gap-2">
                  {!formData.webhookEnsured && formData.repositories?.[0]?.repositoryUrl && (
                    <Button type="button" variant="default" onClick={handleEnsureWebhooks}>
                      <Webhook className="mr-2 h-4 w-4" /> Add Github Webhooks
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {initialLoading ? (
                  <div className="flex items-center gap-2 py-8">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading settings...</span>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {errors.general && (
                      <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                        <p className="text-sm text-destructive">{errors.general}</p>
                      </div>
                    )}
                    {saved && (
                      <div className="p-3 rounded-md bg-green-50 border border-green-200">
                        <p className="text-sm text-green-700">Configuration saved successfully!</p>
                      </div>
                    )}
                    <ProjectInfoForm
                      data={{ name: formData.name, description: formData.description }}
                      errors={errors}
                      loading={loading}
                      onChange={handleProjectInfoChange}
                    />
                    <RepositoryForm
                      data={{
                        repositories: formData.repositories || [{ repositoryUrl: "", branch: "main", name: "" }],
                      }}
                      errors={errors}
                      loading={loading}
                      onChange={handleRepositoryChange}
                      onValidationChange={setRepoValidationErrors}
                    />
                    <SwarmForm
                      data={{
                        swarmUrl: formData.swarmUrl,
                        swarmApiKey: formData.swarmApiKey || "",
                        swarmSecretAlias: formData.swarmSecretAlias,
                      }}
                      errors={errors}
                      loading={loading}
                      onChange={handleSwarmChange}
                    />
                    <EnvironmentForm
                      data={{
                        poolName: formData.poolName,
                        poolCpu: formData.poolCpu || "2",
                        poolMemory: formData.poolMemory || "8Gi",
                        environmentVariables: formData.environmentVariables,
                      }}
                      errors={errors}
                      loading={loading}
                      onChange={handleEnvironmentChange}
                      onEnvVarsChange={handleEnvVarsChange}
                    />
                    <ServicesForm data={formData.services} loading={loading} onChange={handleServicesChange} />
                    <FileTabs
                      fileContents={formData.containerFiles}
                      originalContents={formData.containerFiles}
                      onChange={handleFileChange}
                    />
                    <Button type="submit" disabled={loading || Object.keys(repoValidationErrors).length > 0}>
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save
                        </>
                      )}
                    </Button>
                    {Object.keys(repoValidationErrors).length > 0 && (
                      <p className="text-sm text-amber-600 mt-2">
                        All repositories must be verified with admin access before saving.
                      </p>
                    )}
                  </form>
                )}
              </CardContent>
            </Card>
            <RerunIngest workspaceId={workspaceId} workspaceName={workspaceName} />
          </div>
          <div className="w-full lg:w-[420px] lg:shrink-0 lg:sticky lg:top-6">
            <PodRepairSection />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="infrastructure">
        <div className="max-w-2xl space-y-6 mt-6">
          <Neo4jConfigSettings />
        </div>
      </TabsContent>

      <TabsContent value="integrations">
        <div className="max-w-2xl space-y-6 mt-6">
          <VercelIntegrationSettings />
          <SphinxIntegrationSettings />
        </div>
      </TabsContent>

      <TabsContent value="developer">
        <div className="max-w-2xl space-y-6 mt-6">
          <ApiKeysSettings />
          <NodeTypeOrderSettings />
        </div>
      </TabsContent>
    </Tabs>
  );
}
