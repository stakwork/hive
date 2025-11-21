import { useEffect, useState } from "react";
import { Screenshot } from "@/types/common";

export function usePlaywrightReplay(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  workspaceId: string | null = null,
  taskId: string | null = null,
  onScreenshotError?: (message: string) => void,
) {
  const [isPlaywrightReplaying, setIsPlaywrightReplaying] = useState(false);
  const [isPlaywrightPaused, setIsPlaywrightPaused] = useState(false);
  const [playwrightProgress, setPlaywrightProgress] = useState({ current: 0, total: 0 });

  const [playwrightStatus, setPlaywrightStatus] = useState("idle");
  const [currentAction, setCurrentAction] = useState(null);
  const [replayErrors, setReplayErrors] = useState<
    { message: string; actionIndex: number; action: string; timestamp: string }[]
  >([]);
  const [replayScreenshots, setReplayScreenshots] = useState<Screenshot[]>([]);
  const [replayActions, setReplayActions] = useState<unknown[]>([]);
  const [previewActions, setPreviewActions] = useState<unknown[]>([]);

  const previewPlaywrightReplay = (testCode: string) => {
    if (!iframeRef?.current?.contentWindow) {
      return false;
    }

    if (!testCode || typeof testCode !== "string") {
      return false;
    }

    if (!testCode.includes("page.") || !testCode.includes("test(")) {
      return false;
    }

    try {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "staktrak-playwright-replay-preview",
          testCode,
        },
        "*",
      );

      return true;
    } catch (error) {
      console.error("Error previewing Playwright test:", error);
      return false;
    }
  };

  const startPlaywrightReplay = (testCode: string) => {
    if (!iframeRef?.current?.contentWindow) {
      return false;
    }

    if (!testCode || typeof testCode !== "string") {
      return false;
    }

    if (!testCode.includes("page.") || !testCode.includes("test(")) {
      return false;
    }

    setIsPlaywrightReplaying(true);
    setIsPlaywrightPaused(false);
    setPlaywrightStatus("playing");
    setReplayErrors([]);
    setCurrentAction(null);
    setReplayScreenshots([]);
    setReplayActions([]);

    try {
      const container = document.querySelector(".iframe-container");
      if (container) {
        container.classList.add("playwright-replaying");
      }

      iframeRef.current.contentWindow.postMessage(
        {
          type: "staktrak-playwright-replay-start",
          testCode,
        },
        "*",
      );

      return true;
    } catch (error) {
      console.error("Error starting Playwright replay:", error);
      setIsPlaywrightReplaying(false);

      const container = document.querySelector(".iframe-container");
      if (container) {
        container.classList.remove("playwright-replaying");
      }

      return false;
    }
  };

  const pausePlaywrightReplay = () => {
    if (!isPlaywrightReplaying || !iframeRef?.current?.contentWindow) return;

    try {
      iframeRef.current.contentWindow.postMessage({ type: "staktrak-playwright-replay-pause" }, "*");
      setIsPlaywrightPaused(true);
      setPlaywrightStatus("paused");
    } catch (error) {
      console.error("Error pausing Playwright replay:", error);
    }
  };

  const resumePlaywrightReplay = () => {
    if (!isPlaywrightReplaying || !isPlaywrightPaused || !iframeRef?.current?.contentWindow) return;

    try {
      iframeRef.current.contentWindow.postMessage({ type: "staktrak-playwright-replay-resume" }, "*");
      setIsPlaywrightPaused(false);
      setPlaywrightStatus("playing");
    } catch (error) {
      console.error("Error resuming Playwright replay:", error);
    }
  };

  const stopPlaywrightReplay = () => {
    if (!isPlaywrightReplaying || !iframeRef?.current?.contentWindow) return;

    try {
      iframeRef.current.contentWindow.postMessage({ type: "staktrak-playwright-replay-stop" }, "*");
      setIsPlaywrightReplaying(false);
      setIsPlaywrightPaused(false);
      setPlaywrightStatus("idle");
      setCurrentAction(null);
      setPlaywrightProgress({ current: 0, total: 0 });

      const container = document.querySelector(".iframe-container");
      if (container) {
        container.classList.remove("playwright-replaying");
      }
    } catch (error) {
      console.error("Error stopping Playwright replay:", error);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      if (!data || !data.type) return;

      switch (data.type) {
        case "staktrak-playwright-replay-preview-ready":
          setPreviewActions(data.actions || []);
          break;

        case "staktrak-playwright-replay-preview-error":
          console.error("Playwright preview error:", data.error);
          setPreviewActions([]);
          break;

        case "staktrak-playwright-replay-started":
          setPlaywrightProgress({ current: 0, total: data.totalActions || 0 });
          setReplayActions(data.actions || []);
          break;

        case "staktrak-playwright-replay-progress":
          setPlaywrightProgress({ current: data.current, total: data.total });
          setCurrentAction(data.action);
          break;

        case "staktrak-playwright-replay-completed":
          setIsPlaywrightReplaying(false);
          setIsPlaywrightPaused(false);
          setPlaywrightStatus("completed");
          setCurrentAction(null);

          const container = document.querySelector(".iframe-container");
          if (container) {
            container.classList.remove("playwright-replaying");
          }

          break;

        case "staktrak-playwright-replay-error":
          const errorMsg = data.error || "Unknown error";
          setReplayErrors((prev) => [
            ...prev,
            {
              message: errorMsg,
              actionIndex: data.actionIndex,
              action: data.action,
              timestamp: new Date().toISOString(),
            },
          ]);

          // Don't stop replay on error, just log it
          console.warn("Playwright replay error:", errorMsg);
          break;

        case "staktrak-playwright-replay-paused":
          setIsPlaywrightPaused(true);
          setPlaywrightStatus("paused");
          break;

        case "staktrak-playwright-replay-resumed":
          setIsPlaywrightPaused(false);
          setPlaywrightStatus("playing");
          break;

        case "staktrak-playwright-replay-stopped":
          setIsPlaywrightReplaying(false);
          setIsPlaywrightPaused(false);
          setPlaywrightStatus("idle");
          setCurrentAction(null);
          setPlaywrightProgress({ current: 0, total: 0 });

          const stopContainer = document.querySelector(".iframe-container");
          if (stopContainer) {
            stopContainer.classList.remove("playwright-replaying");
          }
          break;

        case "staktrak-playwright-screenshot-captured":
          console.log("[Screenshot] Captured:", { actionIndex: data.actionIndex, url: data.url, workspaceId, taskId });

          // Add screenshot to local state immediately for display
          const newScreenshot: Screenshot = {
            id: data.id,
            actionIndex: data.actionIndex,
            dataUrl: data.screenshot,
            timestamp: data.timestamp,
            url: data.url,
          };

          setReplayScreenshots((prev) => [...prev, newScreenshot]);

          // Upload to S3 asynchronously (don't block replay)
          if (workspaceId && data.screenshot) {
            console.log("[Screenshot] Starting S3 upload...", { workspaceId, taskId });
            fetch("/api/screenshots/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dataUrl: data.screenshot,
                workspaceId,
                taskId: taskId || null,
                actionIndex: data.actionIndex,
                pageUrl: data.url,
                timestamp: data.timestamp,
              }),
            })
              .then(async (response) => {
                if (!response.ok) {
                  const error = await response.json();
                  throw new Error(error.error || "Upload failed");
                }
                return response.json();
              })
              .then((uploaded) => {
                console.log("[Screenshot] S3 upload successful:", uploaded);
                // Update screenshot in state with S3 details
                setReplayScreenshots((prev) =>
                  prev.map((s) =>
                    s.id === data.id ? { ...s, s3Key: uploaded.s3Key, s3Url: uploaded.s3Url, hash: uploaded.hash } : s,
                  ),
                );
              })
              .catch((error) => {
                console.error("[Screenshot] S3 upload failed:", error);
                // Continue anyway - screenshot is still available locally via dataUrl
              });
          } else {
            console.log("[Screenshot] Skipping S3 upload - missing workspaceId or screenshot data");
          }
          break;

        case "staktrak-playwright-screenshot-error":
          console.warn(`Screenshot failed for action ${data.actionIndex}:`, data.error);
          if (onScreenshotError) {
            onScreenshotError(`Screenshot capture failed for action ${data.actionIndex}`);
          }
          // Error is logged but doesn't interrupt replay
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onScreenshotError, workspaceId, taskId]);

  return {
    isPlaywrightReplaying,
    isPlaywrightPaused,
    playwrightStatus,
    playwrightProgress,
    currentAction,
    replayErrors,
    replayScreenshots,
    replayActions,
    previewActions,
    previewPlaywrightReplay,
    startPlaywrightReplay,
    pausePlaywrightReplay,
    resumePlaywrightReplay,
    stopPlaywrightReplay,
  };
}
