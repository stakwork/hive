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
  taskId: string;
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

      // Collect all task IDs from all phases
      const taskIds = feature.phases.flatMap((phase) =>
        phase.tasks.map((task) => task.id)
      );

      if (taskIds.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch screenshots for all tasks in parallel
      const results = await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            const response = await fetch(
              `/api/screenshots?workspaceId=${workspaceId}&taskId=${taskId}`,
              {
                credentials: 'include',
              }
            );
            if (!response.ok) return null;
            const data = await response.json();
            return {
              taskId,
              screenshots: data.screenshots || [],
            };
          } catch (error) {
            console.error(`Error fetching screenshots for task ${taskId}:`, error);
            return null;
          }
        })
      );

      // Group screenshots by task and normalize the data
      const grouped: GroupedScreenshots[] = [];
      const flat: Screenshot[] = [];

      results.forEach((result) => {
        if (!result || result.screenshots.length === 0) return;

        // Find task title
        const task = feature.phases
          .flatMap((p) => p.tasks)
          .find((t) => t.id === result.taskId);

        if (!task) return;

        // Normalize screenshots: map s3Url to dataUrl for ScreenshotModal compatibility
        const normalizedScreenshots: Screenshot[] = result.screenshots
          .map((s: any) => ({
            id: s.id,
            actionIndex: s.actionIndex,
            dataUrl: s.s3Url ?? "", // Map s3Url to dataUrl
            timestamp: s.timestamp,
            url: s.pageUrl,
            s3Key: s.s3Key,
            s3Url: s.s3Url,
            hash: s.hash,
          }))
          .sort((a: { actionIndex: number }, b: { actionIndex: number }) => a.actionIndex - b.actionIndex);

        grouped.push({
          taskId: result.taskId,
          taskTitle: task.title,
          screenshots: normalizedScreenshots,
        });

        flat.push(...normalizedScreenshots);
      });

      setGroupedScreenshots(grouped);
      setAllScreenshots(flat);
      setLoading(false);
    }

    fetchScreenshots();
  }, [feature, workspaceId]);

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

  if (loading) {
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
