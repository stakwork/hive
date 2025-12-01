"use client";

import { ServiceDataConfig } from "@/components/stakgraph/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useEnvironmentVars } from "@/hooks/useEnvironmentVars";
import { parseEnv } from "@/lib/env-parser";
import { Clipboard, Loader2, Save, Settings, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ServicesForm from "@/components/stakgraph/forms/ServicesForm";
import {
  devcontainerJsonContent,
  dockerComposeContent,
  dockerfileContent,
  formatPM2Apps,
  generatePM2Apps,
} from "../../utils/devContainerUtils";
import { ModalComponentProps } from "./ModlaProvider";

const getFiles = (
  repoName: string,
  servicesData: ServiceDataConfig[],
) => {
  const pm2Apps = generatePM2Apps(repoName, servicesData);

  return {
    "devcontainer.json": devcontainerJsonContent(repoName),
    "pm2.config.js": `module.exports = {
  apps: ${formatPM2Apps(pm2Apps)},
};
`,
    "docker-compose.yml": dockerComposeContent(),
    Dockerfile: dockerfileContent(),
  };
};

type ServicesModalProps = {
  /** optional: anything you might want to pass in future */
};

export default function ServicesModal({
  onResolve,
  onReject,
}: ModalComponentProps<ServicesModalProps>) {
  const { slug, id: workspaceId, updateWorkspace } = useWorkspace();
  const [loading, setLoading] = useState(false);

  // Local state for services and environment variables
  const [services, setServices] = useState<ServiceDataConfig[]>([]);
  const {
    envVars,
    handleEnvChange,
    handleAddEnv,
    handleRemoveEnv,
    setEnvVars,
    bulkAddEnvVars,
  } = useEnvironmentVars();
  const [dataLoading, setDataLoading] = useState(true);
  const [repoName, setRepoName] = useState<string>("");
  const [showImportSection, setShowImportSection] = useState(false);
  const [showAdvancedSection, setShowAdvancedSection] = useState(false);

  // Load settings when modal opens
  useEffect(() => {
    const loadData = async () => {
      if (!slug) return;

      setDataLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${slug}/stakgraph`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const settings = result.data;

            // Set services
            if (settings.services) {
              setServices(settings.services);
            }

            // Set environment variables
            if (settings.environmentVariables && settings.environmentVariables.length > 0) {
              setEnvVars(
                settings.environmentVariables.map((env: { name: string; value: string }) => ({
                  name: env.name,
                  value: env.value,
                  show: false,
                }))
              );
            }

            // Set repo name from swarm data
            if (settings.repositoryName) {
              setRepoName(settings.repositoryName);
            } else {
              // Fallback to slug if no repo name in swarm
              setRepoName(slug);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        toast.error("Error", {
          description: "Failed to load settings",
        });
      } finally {
        setDataLoading(false);
      }
    };

    loadData();
  }, [slug]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onReject("esc");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReject]);

  const handlePasteEnv = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseEnv(text);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast.error("No variables found", {
          description: "The clipboard content doesn't contain valid environment variables.",
        });
        return;
      }

      bulkAddEnvVars(parsed);
      toast.success("Variables imported", {
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      console.error("Failed to paste environment variables:", err);
      toast.error("Paste failed", {
        description: "Unable to read from clipboard. Please try again.",
      });
    }
  };

  const handleFileContent = (content: string, fileName: string) => {
    try {
      const parsed = parseEnv(content);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast.error("No variables found", {
          description: `The file "${fileName}" doesn't contain valid environment variables.`,
        });
        return;
      }

      bulkAddEnvVars(parsed);
      toast.success("Variables imported", {
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''} from ${fileName}.`,
      });
      setShowImportSection(false);
    } catch (err) {
      console.error("Failed to parse file:", err);
      toast.error("Import failed", {
        description: "Failed to parse the file. Please check the format.",
      });
    }
  };

  const handleServicesChange = (updatedServices: ServiceDataConfig[]) => {
    setServices(updatedServices);
  };

  const handleSave = useCallback(async () => {
    if (!slug || !workspaceId) {
      toast.error("Error", {
        description: "Workspace not ready",
      });
      return;
    }

    setLoading(true);
    try {
      // Clean up environment variables
      const cleanedEnvVars = envVars
        .filter((v) => v.name.trim() !== "")
        .map(({ name, value }) => ({ name: name.trim(), value }));

      // Save both services and environment variables
      const swarmResponse = await fetch("/api/swarm", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          services: services,
          envVars: cleanedEnvVars,

          workspaceId: workspaceId,
        }),
      });

      if (!swarmResponse.ok) {
        throw new Error("Failed to update swarm");
      }

      // Generate container files using the repo name from swarm data
      const files = getFiles(repoName, services);

      const base64EncodedFiles = Object.entries(files).reduce(
        (acc, [name, content]) => {
          acc[name] = Buffer.from(content).toString("base64");
          return acc;
        },
        {} as Record<string, string>,
      );

      // Create pool after swarm update
      await fetch("/api/pool-manager/create-pool", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          container_files: base64EncodedFiles,
          workspaceId: workspaceId,
        }),
      });

      updateWorkspace({
        poolState: 'COMPLETE',
      });

      toast.success("Configuration saved", {
        description: "Your services, environment variables, and pool have been updated.",
      });
      onResolve(true);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Error", {
        description: "Failed to save settings. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [slug, workspaceId, services, envVars, repoName, onResolve, updateWorkspace]);


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
            </div>
          </CardHeader>
          <CardContent className="overflow-y-auto max-h-[calc(90vh-120px)]">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold mb-2">Environment Variables</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Add any environment variables your code environment needs.
              </p>
              
              {/* Security Warning */}
              <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Development environment only:</strong> Do not use production credentials or API keys. Use development/testing keys only.
                </p>
              </div>

              {/* Import section */}
              <div className="bg-muted/30 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Quick import:</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handlePasteEnv}
                    disabled={loading || dataLoading}
                    className="h-7"
                  >
                    <Clipboard className="w-3.5 h-3.5 mr-1.5" />
                    Paste ENVs
                  </Button>
                  <span className="text-muted-foreground">or</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowImportSection(!showImportSection)}
                    disabled={loading || dataLoading}
                    className="h-7"
                  >
                    File import
                  </Button>
                </div>

                {showImportSection && (
                  <div className="mt-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                    <FileDropZone
                      onFileContent={handleFileContent}
                      disabled={loading || dataLoading}
                      className="max-w-full"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {envVars.map((env, idx) => (
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
                      disabled={envVars.length === 1 || loading}
                    >
                      Remove
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddEnv}
                  disabled={loading || dataLoading}
                  className="mt-2"
                >
                  Add Variable
                </Button>
              </div>

              {/* Advanced Services Section */}
              <div className="border-t pt-4 mt-6">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAdvancedSection(!showAdvancedSection)}
                  disabled={loading || dataLoading}
                  className="flex items-center space-x-2 p-0 h-auto text-sm font-medium hover:bg-transparent mb-4"
                >
                  {showAdvancedSection ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Settings className="w-4 h-4" />
                  <span>Advanced Services Configuration</span>
                </Button>

                {showAdvancedSection && (
                  <div className="animate-in fade-in-0 slide-in-from-top-2 duration-200">
                    <div className="bg-muted/30 rounded-lg p-4">
                      <p className="text-sm text-muted-foreground mb-4">
                        Configure services, ports, and scripts for your development environment.
                      </p>
                      <ServicesForm
                        data={services}
                        loading={loading || dataLoading}
                        onChange={handleServicesChange}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
          <div className="p-6 border-t">
            <Button onClick={handleSave} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Confirm setup
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
