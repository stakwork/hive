"use client";

import { ServiceDataConfig } from "@/components/stakgraph/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { parseEnv } from "@/lib/env-parser";
import { Clipboard, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  // Local state for services and environment variables
  const [services, setServices] = useState<ServiceDataConfig[]>([]);
  const [localVars, setLocalVars] = useState<{ name: string; value: string }[]>(
    [{ name: "", value: "" }],
  );
  const [dataLoading, setDataLoading] = useState(true);
  const [repoName, setRepoName] = useState<string>("");
  const [showImportSection, setShowImportSection] = useState(false);

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
              setLocalVars(settings.environmentVariables);
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
        toast({
          title: "Error",
          description: "Failed to load settings",
          variant: "destructive",
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

  const bulkAddEnvVars = (parsed: Record<string, string>) => {
    const newVars = Object.entries(parsed).map(([name, value]) => ({
      name,
      value,
    }));
    setLocalVars((prev) => {
      const filtered = prev.filter((v) => v.name.trim() !== "");
      return [...filtered, ...newVars];
    });
  };

  const handlePasteEnv = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseEnv(text);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast({
          title: "No variables found",
          description: "The clipboard content doesn't contain valid environment variables.",
          variant: "destructive",
        });
        return;
      }

      bulkAddEnvVars(parsed);
      toast({
        title: "Variables imported",
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      console.error("Failed to paste environment variables:", err);
      toast({
        title: "Paste failed",
        description: "Unable to read from clipboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileContent = (content: string, fileName: string) => {
    try {
      const parsed = parseEnv(content);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast({
          title: "No variables found",
          description: `The file "${fileName}" doesn't contain valid environment variables.`,
          variant: "destructive",
        });
        return;
      }

      bulkAddEnvVars(parsed);
      toast({
        title: "Variables imported",
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''} from ${fileName}.`,
      });
      setShowImportSection(false);
    } catch (err) {
      console.error("Failed to parse file:", err);
      toast({
        title: "Import failed",
        description: "Failed to parse the file. Please check the format.",
        variant: "destructive",
      });
    }
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

      toast({
        title: "Configuration saved",
        description: "Your services, environment variables, and pool have been updated.",
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
  }, [slug, workspaceId, services, localVars, repoName, toast, onResolve]);


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
              <p className="text-sm text-muted-foreground mb-4">
                Add any environment variables your code environment needs.
              </p>

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
                  disabled={loading || dataLoading}
                  className="mt-2"
                >
                  Add Variable
                </Button>
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
