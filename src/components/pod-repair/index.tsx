"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { toast } from "sonner";
import {
  Bot,
  Circle,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  Wrench,
} from "lucide-react";

interface StakworkRun {
  id: string;
  projectId: number | null;
  createdAt: string;
}

type PodState = "COMPLETED" | "FAILED" | "NOT_STARTED" | "VALIDATING";

const podStateConfig: Record<PodState, { label: string; dotClassName: string }> = {
  COMPLETED: { label: "Healthy", dotClassName: "fill-green-500 text-green-500" },
  FAILED: { label: "Failed", dotClassName: "fill-red-500 text-red-500" },
  VALIDATING: { label: "Validating", dotClassName: "fill-yellow-500 text-yellow-500" },
  NOT_STARTED: { label: "Not Started", dotClassName: "fill-muted-foreground text-muted-foreground" },
};

function PodStateInline({ state, repoCount }: { state: PodState; repoCount: number }) {
  const c = podStateConfig[state] || podStateConfig.NOT_STARTED;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
      <Circle className={`h-1.5 w-1.5 ${c.dotClassName}`} />
      <span>{c.label}</span>
      <span>&middot;</span>
      <span>{repoCount} {repoCount === 1 ? "repo" : "repos"}</span>
    </div>
  );
}

export function PodRepairSection() {
  const { slug, id: workspaceId, workspace, isOwner, isAdmin } = useWorkspace();
  const { formData, handleProjectInfoChange, saveSettings } = useStakgraphStore();

  const [runs, setRuns] = useState<StakworkRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [message, setMessage] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  const isPoolActive = workspace?.poolState === "COMPLETE";
  const canTrigger = isOwner || isAdmin;
  const podState = (workspace?.podState || "NOT_STARTED") as PodState;
  const repoCount = formData.repositories?.filter((r) => r.repositoryUrl).length || 0;

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    setRunsLoading(true);
    try {
      const res = await fetch(
        `/api/stakwork/runs?workspaceId=${workspaceId}&type=POD_REPAIR&limit=5`
      );
      const data = await res.json();
      if (data.success) {
        setRuns(data.runs || []);
      }
    } catch {
      // silently fail
    } finally {
      setRunsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (isPoolActive) {
      fetchRuns();
    }
  }, [isPoolActive, fetchRuns]);

  const handleTriggerRepair = async () => {
    if (!slug) return;
    setTriggering(true);
    try {
      const res = await fetch(`/api/w/${slug}/pool/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error("Repair failed", {
          description: data.error || data.message || "Unknown error",
        });
        return;
      }

      toast.success("Repair triggered", {
        description: data.projectId
          ? `Stakwork project #${data.projectId}`
          : "Repair workflow started",
      });
      setMessage("");
      setShowPrompt(false);
      fetchRuns();
    } catch {
      toast.error("Repair failed", {
        description: "Could not reach the server",
      });
    } finally {
      setTriggering(false);
    }
  };

  const handleStartEditDescription = () => {
    setDescriptionDraft(formData.description || "");
    setEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!slug) return;
    setSavingDescription(true);
    handleProjectInfoChange({ description: descriptionDraft });
    await saveSettings(slug);
    setSavingDescription(false);
    setEditingDescription(false);
  };

  const handleCancelEditDescription = () => {
    setEditingDescription(false);
    setDescriptionDraft("");
  };

  if (!isPoolActive) return null;

  return (
    <Card className="py-5 gap-0">
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Pod Agent</p>
            <PodStateInline state={podState} repoCount={repoCount} />
          </div>
          {canTrigger && !showPrompt && (
            <Button size="sm" variant="outline" onClick={() => setShowPrompt(true)}>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Repair
            </Button>
          )}
        </div>

        {/* Setup description */}
        {editingDescription ? (
          <div className="space-y-2">
            <Textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Describe your project setup..."
              rows={3}
              className="resize-none text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSaveDescription}
                disabled={savingDescription}
              >
                {savingDescription ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : null}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelEditDescription}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="group flex items-start gap-2 cursor-pointer rounded-md -mx-2 px-2 py-1 hover:bg-muted/50 transition-colors"
            onClick={handleStartEditDescription}
          >
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              {formData.description || "Add a project description..."}
            </p>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
          </div>
        )}

        <Separator />

        {/* Recent runs */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            History
          </p>
          {runsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </div>
          ) : runs.length > 0 ? (
            <div className="space-y-0.5">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
                  <span className="text-muted-foreground">
                    {formatRelativeOrDate(run.createdAt)}
                  </span>
                  {run.projectId && (
                    <a
                      href={`https://jobs.stakwork.com/admin/projects/${run.projectId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      #{run.projectId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          )}
        </div>

        {/* Expandable repair prompt */}
        {showPrompt && (
          <>
            <Separator />
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Repair Instructions
              </p>
              <Textarea
                placeholder="Describe what needs fixing..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="resize-none text-sm bg-background"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowPrompt(false);
                    setMessage("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleTriggerRepair}
                  disabled={triggering}
                >
                  {triggering ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Run Repair
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
