"use client";

import { EnvironmentForm, RepositoryForm, ServicesForm, SwarmForm } from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { PodRepairSection } from "@/components/pod-repair";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { ArrowLeft, Loader2, Save, Settings, Webhook } from "lucide-react";
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
    handleRepositoryChange,
    handleSwarmChange,
    handleEnvironmentChange,
    handleEnvVarsChange,
    handleServicesChange,
    handleFileChange,
  } = useStakgraphStore();

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
          toast.error("Permission Required", {
            description: data.message || "Admin access required to manage webhooks on this repository",
          });
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

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pool Status" description="Configure your pool settings for development environment" />
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

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <Card className="w-full lg:max-w-2xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pool Settings</CardTitle>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" title="Infrastructure settings">
                    <Settings className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm">Infrastructure</h4>
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
                  </div>
                </PopoverContent>
              </Popover>
              {!formData.webhookEnsured && formData.repositories?.[0]?.repositoryUrl ? (
                <Button type="button" variant="default" size="sm" onClick={handleEnsureWebhooks}>
                  <Webhook className="mr-2 h-4 w-4" />
                  Add Webhooks
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              {errors.general && (
                <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <p className="text-sm text-destructive">{errors.general}</p>
                </div>
              )}

              {saved && (
                <div className="mb-4 p-3 rounded-md bg-green-50 border border-green-200">
                  <p className="text-sm text-green-700">Configuration saved successfully!</p>
                </div>
              )}

              <Tabs defaultValue="repositories">
                <TabsList className="mb-4">
                  <TabsTrigger value="repositories">Repositories</TabsTrigger>
                  <TabsTrigger value="environment">Environment</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                </TabsList>

                <TabsContent value="repositories">
                  <RepositoryForm
                    data={{
                      repositories: formData.repositories || [
                        { repositoryUrl: "", branch: "main", name: "" },
                      ],
                    }}
                    errors={errors}
                    loading={loading}
                    onChange={handleRepositoryChange}
                  />
                </TabsContent>

                <TabsContent value="environment">
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
                </TabsContent>

                <TabsContent value="services" className="space-y-6">
                  <ServicesForm data={formData.services} loading={loading} onChange={handleServicesChange} />
                  <FileTabs
                    fileContents={formData.containerFiles}
                    originalContents={formData.containerFiles}
                    onChange={handleFileChange}
                  />
                </TabsContent>
              </Tabs>

              <div className="sticky bottom-0 pt-4 mt-4 border-t bg-card">
                <Button type="submit" disabled={loading} className="w-full">
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
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="w-full lg:w-[420px] lg:shrink-0 lg:sticky lg:top-6">
          <PodRepairSection />
        </div>
      </div>
    </div>
  );
}
