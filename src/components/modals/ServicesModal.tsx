"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { ServicesForm } from "@/components/stakgraph";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useWizardStore } from "@/stores/useWizardStore";
import { ServiceDataConfig } from "@/components/stakgraph/types";
import { Save, Loader2 } from "lucide-react";
import { ModalComponentProps } from "./ModlaProvider";

type ServicesModalProps = {
  /** optional: anything you might want to pass in future */
};

export default function ServicesModal({
  onResolve,
  onReject,
}: ModalComponentProps<ServicesModalProps>) {
  const { slug, id: workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const {
    formData,
    loadSettings,
    handleServicesChange,
  } = useStakgraphStore();

  // Environment variables state (from wizard store)
  const services = useWizardStore((s) => s.services);
  const setEnvVars = useWizardStore((s) => s.setEnvVars);
  const envVars = useWizardStore((s) => s.envVars);
  const [localVars, setLocalVars] = useState<{ name: string; value: string }[]>(
    [],
  );

  // Load settings when modal opens
  React.useEffect(() => {
    if (slug) {
      loadSettings(slug);
    }
  }, [slug, loadSettings]);

  // Initialize environment variables from services
  useEffect(() => {
    if (envVars?.length > 0) {
      setLocalVars(envVars);
      return;
    }
    const collectedVars: { name: string; value: string }[] = [];
    services.forEach((service) => {
      Object.entries(service.env || {}).forEach(([key, value]) => {
        collectedVars.push({ name: key, value });
      });
    });
    setLocalVars(
      collectedVars.length > 0 ? collectedVars : [{ name: "", value: "" }],
    );
  }, [services, envVars]);

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onReject("esc");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReject]);

  const handleEnvChange = (
    index: number,
    field: "name" | "value",
    value: string,
  ) => {
    setLocalVars((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleAddEnv = () => {
    setLocalVars((prev) => [...prev, { name: "", value: "" }]);
  };

  const handleRemoveEnv = (index: number) => {
    setLocalVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = useCallback(async () => {
    if (!slug || !workspaceId) {
      toast({
        title: "Error",
        description: "Workspace not ready",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Clean up environment variables
      const cleanedEnvVars = localVars
        .filter((v) => v.name.trim() !== "")
        .map(({ name, value }) => ({ name: name.trim(), value }));

      setEnvVars(cleanedEnvVars);

      // Save both services and environment variables
      await fetch("/api/swarm", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          services: formData.services,
          envVars: cleanedEnvVars,
          workspaceId: workspaceId,
        }),
      });

      toast({
        title: "Settings saved",
        description: "Your services and environment configuration has been saved.",
      });
      onResolve(true);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [slug, workspaceId, formData.services, localVars, setEnvVars, toast, onResolve]);

  const onServicesChange = useCallback(
    (data: ServiceDataConfig[]) => {
      handleServicesChange(data);
    },
    [handleServicesChange],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        className="fixed inset-0 bg-black/50"
        onClick={() => onReject("backdrop")}
      />
      {/* Centered panel */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 grid place-items-center p-4"
      >
        <Card className="max-w-4xl w-full max-h-[90vh] overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Services & Environment Configuration</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onReject("cancel")}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={loading}>
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
          </CardHeader>
          <CardContent className="overflow-y-auto max-h-[calc(90vh-120px)]">
            <Tabs defaultValue="environment" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="environment">Environment</TabsTrigger>
                <TabsTrigger value="services">Services</TabsTrigger>
              </TabsList>

              <TabsContent value="environment" className="mt-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-2">Environment Variables</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Add any environment variables your code environment needs.
                  </p>

                  <div className="space-y-3">
                    {localVars.map((env, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <Input
                          placeholder="KEY"
                          value={env.name}
                          onChange={(e) => handleEnvChange(idx, "name", e.target.value)}
                          className="w-1/3"
                          disabled={loading}
                        />
                        <Input
                          placeholder="VALUE"
                          value={env.value}
                          onChange={(e) => handleEnvChange(idx, "value", e.target.value)}
                          className="w-1/2"
                          disabled={loading}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleRemoveEnv(idx)}
                          className="px-2"
                          disabled={localVars.length === 1 || loading}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAddEnv}
                      disabled={loading}
                      className="mt-2"
                    >
                      Add Variable
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="services" className="mt-6">
                <ServicesForm
                  data={formData.services ?? []}
                  loading={loading}
                  onChange={onServicesChange}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
