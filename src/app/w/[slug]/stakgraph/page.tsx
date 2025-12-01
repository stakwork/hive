"use client";

import { EnvironmentForm, ProjectInfoForm, RepositoryForm, ServicesForm, SwarmForm } from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { ArrowLeft, Loader2, Save, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function StakgraphPage() {
  const { slug, id, refreshCurrentWorkspace } = useWorkspace();
  const router = useRouter();

  const {
    formData,
    errors,
    loading,
    initialLoading,
    saved,
    loadSettings,
    saveSettings,
    handleProjectInfoChange,
    handleRepositoryChange,
    handleSwarmChange,
    handleEnvironmentChange,
    handleEnvVarsChange,
    handleServicesChange,
    handleFileChange,
  } = useStakgraphStore();

  // Load existing settings on component mount
  useEffect(() => {
    if (slug) {
      loadSettings(slug);
    }
  }, [slug, loadSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!slug) return;

    await saveSettings(slug);
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
          toast.error("Permission Required", { description: data.message || "Admin access required to manage webhooks on this repository" });
        } else {
          toast.error("Error", { description: data.message || "Failed to add webhooks" });
        }
        return;
      }

      toast("Webhooks added", { description: "GitHub webhooks have been ensured" });
      await loadSettings(slug!);
    } catch (error) {
      console.error("Failed to ensure webhooks", error);
      toast.error("Error", { description: "Failed to add webhooks" });
    }
  };

  // const allFieldsFilled =
  //   formData.name &&
  //     formData.repositoryUrl &&
  //     formData.swarmUrl &&
  //     formData.swarmSecretAlias &&
  //     formData.poolName
  //     ? true
  //     : false;

  // console.log("allFieldsFilled", allFieldsFilled);

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Stakgraph Configuration" description="Configure your settings for Stakgraph integration" />
        <Card className="max-w-2xl">
          <CardContent className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading settings...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/w/${slug}/settings`)}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Button>
      </div>
      <PageHeader title="Pool Status" description="Configure your pool settings for development environment" />

      <Card className="max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pool Settings</CardTitle>
          <div className="flex gap-2">
            {!formData.webhookEnsured && formData.repositories?.[0]?.repositoryUrl ? (
              <Button type="button" variant="default" onClick={handleEnsureWebhooks}>
                <Webhook className="mr-2 h-4 w-4" />
                Add Github Webhooks
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
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

            <div className="space-y-6">
              <ProjectInfoForm
                data={{
                  name: formData.name,
                  description: formData.description,
                }}
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
                  poolMemory: formData.poolMemory || "4Gi",
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
            </div>

            <Button type="submit" disabled={loading}>
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
