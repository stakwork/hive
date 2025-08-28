import { useState } from "react";
import {
  Artifact,
  ArtifactType,
  BrowserContent,
  BugReportContent,
} from "@/lib/chat";

interface UseDebugSelectionOptions {
  onDebugMessage?: (message: string, artifact: Artifact) => Promise<void>;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface UseDebugSelectionReturn {
  // State
  debugMode: boolean;
  isSubmittingDebug: boolean;
  
  // Actions
  setDebugMode: (mode: boolean) => void;
  handleDebugElement: () => void;
  handleDebugSelection: (
    x: number,
    y: number,
    width: number,
    height: number,
    artifacts: Artifact[],
    activeTab: number,
  ) => Promise<void>;
}

/**
 * Hook for handling debug element selection in browser artifacts
 */
export function useDebugSelection(
  options: UseDebugSelectionOptions
): UseDebugSelectionReturn {
  const { onDebugMessage, iframeRef } = options;
  const [debugMode, setDebugMode] = useState(false);
  const [isSubmittingDebug, setIsSubmittingDebug] = useState(false);

  const handleDebugElement = () => {
    setDebugMode(!debugMode);
  };

  const handleDebugSelection = async (
    x: number,
    y: number,
    width: number,
    height: number,
    artifacts: Artifact[],
    activeTab: number,
  ) => {
    const activeArtifact = artifacts[activeTab];
    const content = activeArtifact.content as BrowserContent;

    setIsSubmittingDebug(true);

    try {
      const iframeElement = iframeRef.current;
      if (!iframeElement) {
        throw new Error("Iframe not found");
      }

      const messageId = `debug-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      const responsePromise = new Promise<
        Array<{ file: string; lines: number[]; context?: string }>
      >((resolve) => {
        const timeout = setTimeout(() => {
          resolve([]);
        }, 10000);

        const handleMessage = (event: MessageEvent) => {
          const iframeOrigin = new URL(content.url).origin;
          if (event.origin !== iframeOrigin) return;

          if (
            event.data?.type === "staktrak-debug-response" &&
            event.data?.messageId === messageId
          ) {
            clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);

            if (event.data.success) {
              resolve(event.data.sourceFiles || []);
            } else {
              resolve([]);
            }
          }
        };

        window.addEventListener("message", handleMessage);
      });

      iframeElement.contentWindow?.postMessage(
        {
          type: "staktrak-debug-request",
          messageId,
          coordinates: { x, y, width, height },
        },
        new URL(content.url).origin,
      );

      const sourceFiles = await responsePromise;

      const bugReportContent: BugReportContent = {
        bugDescription:
          width === 0 && height === 0
            ? `Debug click at coordinates (${x}, ${y})`
            : `Debug selection area ${width}×${height} at coordinates (${x}, ${y})`,
        iframeUrl: content.url,
        method: width === 0 && height === 0 ? "click" : "selection",
        sourceFiles: sourceFiles.length > 0 ? sourceFiles : [
          {
            file: "Source mapping will be available in future update",
            lines: [],
            context: "Debug UI preview - actual source mapping implementation coming soon"
          }
        ],
        coordinates: { x, y, width, height },
      };

      const debugArtifact: Artifact = {
        id: `debug-${Date.now()}`,
        messageId: "",
        type: ArtifactType.BUG_REPORT,
        content: bugReportContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (onDebugMessage) {
        // Use the formatted component message from StakTrak
        const componentMessage = bugReportContent.sourceFiles.find(f => f.message)?.message || "Element analyzed";
        await onDebugMessage(componentMessage, debugArtifact);
      }

      setDebugMode(false);
    } catch (error) {
      console.error("Failed to process debug selection:", error);

      const bugReportContent: BugReportContent = {
        bugDescription: `Debug analysis failed at (${x}, ${y})`,
        iframeUrl: content.url,
        method: width === 0 && height === 0 ? "click" : "selection",
        sourceFiles: [
          {
            file: "Error: Could not extract source information",
            lines: [],
            context: error instanceof Error ? error.message : "Unknown error occurred"
          }
        ],
        coordinates: { x, y, width, height },
      };

      const debugArtifact: Artifact = {
        id: `debug-error-${Date.now()}`,
        messageId: "",
        type: ArtifactType.BUG_REPORT,
        content: bugReportContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (onDebugMessage) {
        try {
          await onDebugMessage(
            `🐛 Debug element analysis (with errors)`,
            debugArtifact,
          );
          setDebugMode(false);
        } catch (chatError) {
          console.error("Failed to send fallback debug message:", chatError);
        }
      }
    } finally {
      setIsSubmittingDebug(false);
    }
  };

  return {
    // State
    debugMode,
    isSubmittingDebug,
    
    // Actions
    setDebugMode,
    handleDebugElement,
    handleDebugSelection,
  };
}