"use client";

import React, { useCallback, useEffect, useState } from "react";
import { redirect } from "next/navigation";
import { Loader2, Shield, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { FindingsList } from "@/components/protect/FindingsList";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { getModelValue, type LlmModelOption } from "@/lib/ai/models";
import { toast } from "sonner";
import type { ProtectFindingsResponse } from "@/types/protect";

export default function ProtectPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { canAdmin, canWrite } = useWorkspaceAccess();
  const [data, setData] = useState<ProtectFindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  const loadFindings = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/protect/findings`);
      if (!response.ok) {
        throw new Error("Failed to load findings");
      }
      const body = (await response.json()) as ProtectFindingsResponse;
      setData(body);
    } catch (error) {
      toast.error("Could not load Protect findings", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setData({ status: "error", findings: [], run: null, error: "Failed to load findings" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace?.slug) {
      void loadFindings(workspace.slug);
    }
  }, [workspace?.slug, loadFindings]);

  useEffect(() => {
    if (!canAdmin || !workspace?.slug) return;

    const loadModelConfig = async () => {
      try {
        const [modelsRes, configRes] = await Promise.all([
          fetch("/api/llm-models"),
          fetch(`/api/workspaces/${workspace.slug}/protect/config`),
        ]);
        const models: LlmModelOption[] = modelsRes.ok
          ? ((await modelsRes.json()).models ?? [])
          : [];
        setLlmModels(models);
        if (models.length === 0) return;

        const stored: string | null = configRes.ok
          ? ((await configRes.json()).securityReviewModel ?? null)
          : null;
        const storedModel = stored
          ? models.find((m) => getModelValue(m) === stored)
          : null;
        const defaultModel = models.find((m) => m.isTaskDefault);
        setSelectedModel(getModelValue(storedModel ?? defaultModel ?? models[0]));
      } catch (error) {
        console.error("Error fetching Protect model config:", error);
      }
    };

    void loadModelConfig();
  }, [canAdmin, workspace?.slug]);

  if (!canAccessDefense) {
    redirect("/");
  }

  const handleModelChange = async (value: string) => {
    if (!workspace?.slug) return;
    const previous = selectedModel;
    setSelectedModel(value);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/protect/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ securityReviewModel: value }),
      });
      if (!response.ok) {
        throw new Error("Failed to save model");
      }
    } catch (error) {
      setSelectedModel(previous);
      toast.error("Could not save model", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  const handleRunReview = async () => {
    if (!workspace?.slug) return;
    setRunning(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/protect/run`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Failed to start review");
      }
      toast("Protect review started");
      await loadFindings(workspace.slug);
    } catch (error) {
      toast.error("Could not start review", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRunning(false);
    }
  };

  const inProgress = data?.status === "in-progress" || running;
  const runDisabled = !canAdmin || inProgress || running;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Protect"
        description="Security findings for this workspace."
        icon={Shield}
        actions={
          canAdmin ? (
            <>
              {llmModels.length > 0 && (
                <Select value={selectedModel} onValueChange={handleModelChange}>
                  <SelectTrigger
                    className="w-auto h-8 text-xs rounded-lg shadow-sm whitespace-nowrap"
                    data-testid="model-selector"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 shrink-0" />
                      <span>
                        {selectedModel
                          ? llmModels.find((m) => getModelValue(m) === selectedModel)?.name ||
                            selectedModel
                          : "Model"}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {llmModels.map((m) => (
                      <SelectItem key={m.id} value={getModelValue(m)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                onClick={handleRunReview}
                disabled={runDisabled}
                data-testid="protect-run-review"
              >
                {(running || inProgress) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run review
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="max-w-5xl space-y-6">
        {loading && (
          <Card data-testid="protect-loading">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading findings…
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "empty" && (
          <Card data-testid="protect-empty">
            <CardContent className="py-10 text-sm text-muted-foreground">
              No review has run yet. {canAdmin ? "Run a full review to scan every repository." : "Ask an admin to run a review."}
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "in-progress" && (
          <Card data-testid="protect-in-progress">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Review in progress.
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "error" && (
          <Card data-testid="protect-error">
            <CardContent className="py-10 text-sm text-muted-foreground">
              {data.error || "Could not load findings from the knowledge graph."}
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "ready" && workspace?.slug && (
          <FindingsList slug={workspace.slug} findings={data.findings} canWrite={canWrite} />
        )}
      </div>
    </div>
  );
}
