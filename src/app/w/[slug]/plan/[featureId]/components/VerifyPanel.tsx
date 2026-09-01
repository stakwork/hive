"use client";

import { useCallback, useEffect, useState } from "react";
import { ScreenshotModal } from "@/components/ScreenshotModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Screenshot } from "@/types/common";
import type { FeatureDetail } from "@/types/roadmap";
import type { ChecklistItem, VerifyCallbackPayload, VerifyOverall } from "@/services/attestor/types";
import { Check, ExternalLink, Loader2, Minus, X } from "lucide-react";

interface VerifyPanelProps {
  feature: FeatureDetail;
  workspaceId: string;
}

interface GroupedScreenshots {
  taskId: string | null;
  taskTitle: string;
  screenshots: Screenshot[];
}

const OVERALL_VARIANT: Record<VerifyOverall, "default" | "destructive" | "secondary"> = {
  passed: "default",
  failed: "destructive",
  pending: "secondary",
};

function StatusIcon({ status }: { status: ChecklistItem["status"] }) {
  if (status === "met") {
    return <Check className="w-4 h-4 text-green-600" aria-label="met" />;
  }
  if (status === "not_met") {
    return <X className="w-4 h-4 text-red-600" aria-label="not met" />;
  }
  return <Minus className="w-4 h-4 text-amber-500" aria-label="pending" />;
}

export function VerifyPanel({ feature, workspaceId }: VerifyPanelProps) {
  const [loading, setLoading] = useState(true);
  const [groupedScreenshots, setGroupedScreenshots] = useState<GroupedScreenshots[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allScreenshots, setAllScreenshots] = useState<Screenshot[]>([]);
  const [checklist, setChecklist] = useState<VerifyCallbackPayload | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const fetchChecklist = useCallback(async () => {
    try {
      const response = await fetch(`/api/features/${feature.id}/verify`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const data = await response.json();
      setChecklist((data.checklist as VerifyCallbackPayload | null) ?? null);
    } catch (error) {
      console.error("Error fetching verification checklist:", error);
    }
  }, [feature.id]);

  useEffect(() => {
    async function fetchScreenshots() {
      setLoading(true);

      try {
        const response = await fetch(`/api/features/${feature.id}/attachments`, {
          credentials: "include",
        });

        if (!response.ok) {
          console.error("Error fetching attachments:", response.statusText);
          setLoading(false);
          return;
        }

        const data = await response.json();
        const attachments: any[] = data.attachments || [];

        const grouped: GroupedScreenshots[] = [];
        const flat: Screenshot[] = [];
        const attachmentsByTask = new Map<string, any[]>();

        attachments.forEach((a: any) => {
          if (a.taskId) {
            const existing = attachmentsByTask.get(a.taskId) || [];
            existing.push(a);
            attachmentsByTask.set(a.taskId, existing);
          }
        });

        attachmentsByTask.forEach((taskAttachments, taskId) => {
          const taskTitle = taskAttachments[0]?.taskTitle || "Untitled Task";

          const normalizedScreenshots: Screenshot[] = taskAttachments
            .map((a: any, index: number) => ({
              id: a.id,
              actionIndex: index,
              dataUrl: a.url,
              timestamp: a.createdAt,
              url: a.filename,
              s3Key: undefined,
              s3Url: a.url,
              hash: undefined,
            }))
            .sort((a, b) => a.actionIndex - b.actionIndex);

          grouped.push({ taskId, taskTitle, screenshots: normalizedScreenshots });
          flat.push(...normalizedScreenshots);
        });

        setGroupedScreenshots(grouped);
        setAllScreenshots(flat);
      } catch (error) {
        console.error("Error fetching screenshots:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchScreenshots();
    fetchChecklist();
  }, [feature.id, workspaceId, fetchChecklist]);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const response = await fetch(`/api/features/${feature.id}/verify`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setVerifyError(data.details || data.error || "Failed to start verification");
        return;
      }
      await fetchChecklist();
    } catch (error) {
      console.error("Error starting verification:", error);
      setVerifyError("Failed to start verification");
    } finally {
      setVerifying(false);
    }
  };

  const handleScreenshotClick = (screenshot: Screenshot) => {
    setSelectedScreenshot(screenshot);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedScreenshot(null);
  };

  const handleNavigate = (screenshot: Screenshot) => {
    setSelectedScreenshot(screenshot);
  };

  return (
    <>
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">Acceptance criteria</h3>
              {checklist && (
                <Badge variant={OVERALL_VARIANT[checklist.overall]}>{checklist.overall}</Badge>
              )}
            </div>
            <Button size="sm" onClick={handleVerify} disabled={verifying}>
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </div>

          {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}

          {checklist ? (
            <div className="space-y-2">
              {checklist.checklist.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-lg border border-border p-3"
                >
                  <div className="mt-0.5">
                    <StatusIcon status={item.status} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{item.text}</p>
                    {item.evidence && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Evidence:</span> {item.evidence}
                      </p>
                    )}
                    {item.cause && (
                      <p className="text-xs text-red-600">
                        <span className="font-medium">Cause:</span> {item.cause}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No verification run yet. Click Verify to check this feature against its acceptance criteria.
            </p>
          )}
        </div>

        {loading && groupedScreenshots.length === 0 ? (
          <div className="space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-6 w-1/3 bg-muted animate-pulse rounded" />
                <div className="grid grid-cols-2 gap-4">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="aspect-video bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : groupedScreenshots.length === 0 ? (
          <div className="text-center p-8 space-y-3">
            <p className="text-muted-foreground text-lg">No screenshots yet</p>
            <p className="text-muted-foreground text-sm">
              Screenshots will appear here once an agent has run a task
            </p>
          </div>
        ) : (
          groupedScreenshots.map((group) => (
            <div key={group.taskId} className="space-y-4">
              <h3 className="text-lg font-semibold">{group.taskTitle}</h3>
              <div className="grid grid-cols-2 gap-4">
                {group.screenshots.map((screenshot) => (
                  <button
                    key={screenshot.id}
                    onClick={() => handleScreenshotClick(screenshot)}
                    className="group relative aspect-video rounded-lg border border-border overflow-hidden hover:border-primary transition-colors bg-muted"
                  >
                    <img
                      src={screenshot.dataUrl}
                      alt={`Step ${screenshot.actionIndex + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white">
                      <ExternalLink className="w-8 h-8 mb-2" />
                      <span className="text-sm">View fullscreen</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                      <div className="text-white text-sm font-medium">
                        Step {screenshot.actionIndex + 1}
                      </div>
                      <div className="text-white/80 text-xs truncate">{screenshot.url}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <ScreenshotModal
        screenshot={selectedScreenshot}
        allScreenshots={allScreenshots}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onNavigate={handleNavigate}
      />
    </>
  );
}
