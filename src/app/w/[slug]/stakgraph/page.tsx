"use client";

import {
  EnvironmentForm,
  ProjectInfoForm,
  RepositoryForm,
  ServicesForm,
  SwarmForm,
} from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { AnimatePresence, motion } from "framer-motion";
import { Webhook, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function StakgraphPage() {
  const { slug, id, refreshCurrentWorkspace } = useWorkspace();
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
      if (!res.ok) throw new Error("Failed to ensure webhooks");
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
        <div className="flex items-center gap-3">
          {/* <Network className="w-8 h-8 text-primary" /> */}
          <div>
            <h1 className="text-3xl font-bold">Stakgraph Configuration</h1>
            <p className="text-muted-foreground">
              Configure your settings for Stakgraph integration
            </p>
          </div>
        </div>
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
      <div className="flex items-center gap-3">
        {/* <Network className="w-8 h-8 text-primary" /> */}
        <div>
          <h1 className="text-3xl font-bold">Stakgraph Configuration</h1>
          <p className="text-muted-foreground">
            Configure your settings for Stakgraph integration
          </p>
          {/* Removed Swarm Status and Last updated */}
        </div>
      </div>

      {/* Subtle: Create Stakgraph section (only if all fields are empty, with smooth animation) */}
      <AnimatePresence>
        {/* FIXME: CHECK FOR WIZARD STATE IF COMPLETED OR NOT */}
        {
          <motion.div
            key="create-stakgraph-prompt"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="max-w-2xl bg-muted/40 rounded-md px-4 py-2 mb-2 flex items-center gap-3"
          >
            <span className="text-sm text-muted-foreground">
              Don&apos;t have a Stakgraph configuration?&nbsp;
            </span>
            <Button asChild variant="ghost" size="sm" className="px-2 h-7">
              <Link href={slug ? `/w/${slug}/code-graph` : "#"}>
                Create Stakgraph
              </Link>
            </Button>
          </motion.div>
        }
      </AnimatePresence>

      <Card className="max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Stakgraph Settings</CardTitle>
          {!formData.webhookEnsured && formData.repositoryUrl ? (
            <Button
              type="button"
              variant="default"
              onClick={handleEnsureWebhooks}
            >
              <Webhook className="mr-2 h-4 w-4" />
              Add Github Webhooks
            </Button>
          ) : null}
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
                <p className="text-sm text-green-700">
                  Configuration saved successfully!
                </p>
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
                  swarmSecretAlias: formData.swarmSecretAlias,
                }}
                errors={errors}
                loading={loading}
                onChange={handleSwarmChange}
              />

              <EnvironmentForm
                data={{
                  poolName: formData.poolName,
                  environmentVariables: formData.environmentVariables,
                }}
                errors={errors}
                loading={loading}
                onChange={handleEnvironmentChange}
                onEnvVarsChange={handleEnvVarsChange}
              />

              <ServicesForm
                data={formData.services}
                loading={loading}
                onChange={handleServicesChange}
              />

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
