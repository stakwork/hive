"use client";

import { useEffect, useState } from "react";
import { ScreenshotModal } from "@/components/ScreenshotModal";
import type { Screenshot } from "@/types/common";
import type { FeatureDetail } from "@/types/roadmap";
import { ExternalLink } from "lucide-react";

interface VerifyPanelProps {
  feature: FeatureDetail;
  workspaceId: string;
}

interface GroupedScreenshots {
  taskId: string | null;
  taskTitle: string;
  screenshots: Screenshot[];
}

export function VerifyPanel({ feature, workspaceId }: VerifyPanelProps) {
  const [loading, setLoading] = useState(true);
  const [groupedScreenshots, setGroupedScreenshots] = useState<
    GroupedScreenshots[]
  >([]);
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allScreenshots, setAllScreenshots] = useState<Screenshot[]>([]);

  useEffect(() => {
    async function fetchScreenshots() {
      setLoading(true);

      try {
        // Fetch all image attachments for this feature in a single request
        const response = await fetch(
          `/api/features/${feature.id}/attachments`,
          { credentials: 'include' }
        );

        if (!response.ok) {
          console.error('Error fetching attachments:', response.statusText);
          setLoading(false);
          return;
        }

        const data = await response.json();
        const attachments: any[] = data.attachments || [];

        // Group attachments by task
        const grouped: GroupedScreenshots[] = [];
        const flat: Screenshot[] = [];

        // Create a map to group attachments by taskId
        const attachmentsByTask = new Map<string, any[]>();

        attachments.forEach((a: any) => {
          if (a.taskId) {
            const existing = attachmentsByTask.get(a.taskId) || [];
            existing.push(a);
            attachmentsByTask.set(a.taskId, existing);
          }
        });

        // Build grouped data for attachments with taskId
        attachmentsByTask.forEach((taskAttachments, taskId) => {
          // Use taskTitle from attachment data (already included in API response)
          const taskTitle = taskAttachments[0]?.taskTitle || "Untitled Task";

          // Normalize and sort attachments
          const normalizedScreenshots: Screenshot[] = taskAttachments
            .map((a: any, index: number) => ({
              id: a.id,
              actionIndex: index, // Use index within this task group
              dataUrl: a.url, // Presigned S3 URL
              timestamp: a.createdAt,
              url: a.filename, // Display filename
              s3Key: undefined,
              s3Url: a.url,
              hash: undefined,
            }))
            .sort((a, b) => a.actionIndex - b.actionIndex);

          grouped.push({
            taskId,
            taskTitle,
            screenshots: normalizedScreenshots,
          });

          flat.push(...normalizedScreenshots);
        });

        setGroupedScreenshots(grouped);
        setAllScreenshots(flat);
      } catch (error) {
        console.error('Error fetching screenshots:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchScreenshots();
  }, [feature.id, workspaceId]);

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

  if (loading && groupedScreenshots.length === 0) {
    return (
      <div className="space-y-6">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-1/3 bg-muted animate-pulse rounded" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3].map((j) => (
                <div
                  key={j}
                  className="aspect-video bg-muted animate-pulse rounded-lg"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (groupedScreenshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-center p-8">
        <div className="space-y-3">
          <p className="text-muted-foreground text-lg">
            No screenshots yet
          </p>
          <p className="text-muted-foreground text-sm">
            Screenshots will appear here once an agent has run a task
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        {groupedScreenshots.map((group) => (
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
                    <div className="text-white/80 text-xs truncate">
                      {screenshot.url}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
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
