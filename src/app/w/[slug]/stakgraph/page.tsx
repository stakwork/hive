"use client";

import { EnvironmentForm, ServicesForm } from "@/components/stakgraph";
import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { Loader2, Save, ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StakgraphPage() {
  const { slug, refreshCurrentWorkspace } = useWorkspace();
  const router = useRouter();

  const {
    formData,
    errors,
    loading,
    initialLoading,
    saved,
    loadSettings,
    saveSettings,
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
        description="Configure your virtual machine environment, services, and container files"
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>VM Environment Settings</CardTitle>
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
                  Save VM Configuration
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
