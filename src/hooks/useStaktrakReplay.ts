import { useEffect, useState } from "react";

export function usePlaywrightReplay(iframeRef: React.RefObject<HTMLIFrameElement | null>) {
  const [isPlaywrightReplaying, setIsPlaywrightReplaying] = useState(false);
  const [isPlaywrightPaused, setIsPlaywrightPaused] = useState(false);
  const [playwrightProgress, setPlaywrightProgress] = useState({ current: 0, total: 0 });

  const [playwrightStatus, setPlaywrightStatus] = useState("idle");
  const [currentAction, setCurrentAction] = useState(null);
  const [replayErrors, setReplayErrors] = useState<
    { message: string; actionIndex: number; action: string; timestamp: string }[]
  >([]);

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
        case "staktrak-playwright-replay-started":
          setPlaywrightProgress({ current: 0, total: data.totalActions || 0 });
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

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return {
    isPlaywrightReplaying,
    isPlaywrightPaused,
    playwrightStatus,
    playwrightProgress,
    currentAction,
    replayErrors,
    startPlaywrightReplay,
    pausePlaywrightReplay,
    resumePlaywrightReplay,
    stopPlaywrightReplay,
  };
}
