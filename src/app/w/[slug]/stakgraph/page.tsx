"use client";

import { EnvironmentForm, ProjectInfoForm, RepositoryForm, ServicesForm, SwarmForm } from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { Webhook, Loader2, Save, ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { GitVisualizer } from "gitsee/client";

export default function StakgraphPage() {
  const { slug, id, refreshCurrentWorkspace } = useWorkspace();
  const router = useRouter();
  const vizInitialized = useRef(false);

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

  const { toast } = useToast();

  // Load existing settings on component mount
  useEffect(() => {
    if (slug) {
      loadSettings(slug);
    }
  }, [slug, loadSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!slug) return;

    await saveSettings(slug, toast);
    refreshCurrentWorkspace();
  };

  useEffect(() => {
    if (vizInitialized.current) return;
    if (!id) return;
    if (!formData.repositoryUrl) return;
    if (!formData.swarmUrl) return;
    // rm -rf node_modules/gitsee && yarn add file:../../evanf/gitsee
    vizInitialized.current = true;
    let viz: GitVisualizer | null = null;
    try {
      const { owner, repo } = parseGithubOwnerRepo(formData.repositoryUrl);
      console.log("start GitVisualizer", owner, repo);
      viz = new GitVisualizer(
        "#vizzy",
        `/api/gitsee?workspaceId=${id}`, // Nextjs proxy endpoint
        {}, // custom headers (optional)
        `${formData.swarmUrl}:3355/gitsee`, // SSE endpoint
      );
      setTimeout(() => {
        viz?.visualize(owner, repo);
      }, 100);
    } catch (error) {
      console.error("Failed to visualize repository", error);
    }
    return () => viz?.destroy();
  }, [id, formData.repositoryUrl, formData.swarmUrl]);

  const handleEnsureWebhooks = async () => {
    try {
      if (!id) {
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
          workspaceId: id,
          repositoryUrl: formData.repositoryUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "INSUFFICIENT_PERMISSIONS") {
          toast({
            title: "Permission Required",
            description: data.message || "Admin access required to manage webhooks on this repository",
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
      await loadSettings(slug!);
    } catch (error) {
      console.error("Failed to ensure webhooks", error);
      toast({
        title: "Error",
        description: "Failed to add webhooks",
        variant: "destructive",
      });
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
      <PageHeader
        title="VM Configuration"
        description="Configure your virtual machine settings for development environment"
      />

      <Card className="max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>VM Settings</CardTitle>
          <div className="flex gap-2">
            {!formData.webhookEnsured && formData.repositoryUrl ? (
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
                data={{ repositoryUrl: formData.repositoryUrl }}
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

      {/* Gitsee section */}
      <Card className="max-w-2xl">
        <CardContent>
          <svg width="500" height="500" id="vizzy"></svg>
        </CardContent>
      </Card>
    </div>
  );
}
