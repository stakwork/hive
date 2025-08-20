"use client";

import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
import {
  Monitor,
  RefreshCw,
  ExternalLink,
  Circle,
  Square,
  Target,
  Copy,
  FlaskConical,
  Bug,
} from "lucide-react";
import {
  Artifact,
  BrowserContent,
  BugReportContent,
  ArtifactType,
} from "@/lib/chat";
import { useStaktrak } from "@/hooks/useStaktrak";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "./prism-dark-plus.css";
import { TestManagerModal } from "./TestManagerModal";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface PlaywrightTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  playwrightTest: string;
}

function PlaywrightTestModal({
  isOpen,
  onClose,
  playwrightTest,
}: PlaywrightTestModalProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isOpen && playwrightTest) {
      // Wait for the DOM element to be rendered
      const timeoutId = setTimeout(() => {
        if (codeRef.current) {
          Prism.highlightElement(codeRef.current);
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [playwrightTest, isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(playwrightTest);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="w-[98vw] h-[70vh] flex flex-col"
        style={{ width: "94vw", maxWidth: "1200px" }}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            Generated Playwright Test
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="flex items-center gap-2 mr-6"
            >
              <Copy className="w-4 h-4" />
              {copied ? "Copied!" : "Copy Test"}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-auto">
            <pre className="text-sm bg-background/50 p-4 rounded border">
              <code ref={codeRef} className="language-javascript">
                {playwrightTest}
              </code>
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DebugOverlayProps {
  isActive: boolean;
  isSubmitting: boolean;
  onDebugSelection: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

function DebugOverlay({
  isActive,
  isSubmitting,
  onDebugSelection,
}: DebugOverlayProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);

  if (!isActive) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionCurrent({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionCurrent({ x, y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!selectionStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    // Calculate selection area (works for both clicks and drags)
    const x = Math.min(selectionStart.x, endX);
    const y = Math.min(selectionStart.y, endY);
    const width = Math.abs(endX - selectionStart.x);
    const height = Math.abs(endY - selectionStart.y);

    onDebugSelection(x, y, width, height);

    // Reset selection state
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionCurrent(null);
  };

  const getSelectionStyle = () => {
    if (!isSelecting || !selectionStart || !selectionCurrent) return {};

    const x = Math.min(selectionStart.x, selectionCurrent.x);
    const y = Math.min(selectionStart.y, selectionCurrent.y);
    const width = Math.abs(selectionCurrent.x - selectionStart.x);
    const height = Math.abs(selectionCurrent.y - selectionStart.y);

    return {
      left: x,
      top: y,
      width,
      height,
    };
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ backgroundColor: "rgba(59, 130, 246, 0.1)" }}
    >
      {/* Selection rectangle (only show if actively selecting and has some size) */}
      {isSelecting && selectionStart && selectionCurrent && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-200/20"
          style={getSelectionStyle()}
        />
      )}

      {/* Debug mode indicator */}
      <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
        {isSubmitting ? (
          <>⏳ Sending debug info...</>
        ) : (
          <>🐛 Debug Mode: Click or drag to identify elements</>
        )}
      </div>
    </div>
  );
}

export function BrowserArtifactPanel({
  artifacts,
  ide,
  onDebugMessage,
}: {
  artifacts: Artifact[];
  ide?: boolean;
  onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Debug state
  const [debugMode, setDebugMode] = useState(false);
  const [isSubmittingDebug, setIsSubmittingDebug] = useState(false);

  // Get the current artifact and its content
  const activeArtifact = artifacts[activeTab];
  const activeContent = activeArtifact?.content as BrowserContent;

  // Use staktrak hook with all the functions
  const {
    currentUrl,
    iframeRef,
    isSetup,
    isRecording,
    isAssertionMode,
    startRecording,
    stopRecording,
    enableAssertionMode,
    disableAssertionMode,
    showPlaywrightModal,
    generatedPlaywrightTest,
    closePlaywrightModal,
  } = useStaktrak(activeContent?.url);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Use currentUrl from staktrak hook, fallback to content.url
  const displayUrl = currentUrl || activeContent?.url;

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleTabOut = (url: string) => {
    window.open(url, "_blank");
  };

  const handleRecordToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleAssertionToggle = () => {
    if (isAssertionMode) {
      disableAssertionMode();
    } else {
      enableAssertionMode();
    }
  };

  // Tab change handler
  const handleTabChange = (newTab: number) => {
    setActiveTab(newTab);
    if (debugMode) {
      setDebugMode(false);
    }
  };

  // Debug handlers
  const handleDebugElement = () => {
    setDebugMode(!debugMode);
  };

  const handleDebugSelection = async (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    const activeArtifact = artifacts[activeTab];
    const content = activeArtifact.content as BrowserContent;

    setIsSubmittingDebug(true);

    try {
      // Get the iframe element for the active tab
      const iframeElement = iframeRef.current;
      if (!iframeElement) {
        throw new Error("Iframe not found");
      }

      // Create unique message ID for tracking responses
      const messageId = `debug-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Set up response listener
      const responsePromise = new Promise<
        Array<{ file: string; lines: number[]; context?: string }>
      >((resolve) => {
        const timeout = setTimeout(() => {
          // If postMessage fails, use empty source files array
          resolve([]);
        }, 10000); // 10 second timeout

        const handleMessage = (event: MessageEvent) => {
          // Verify origin matches iframe URL for security
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
              resolve([]); // Graceful fallback on error
            }
          }
        };

        window.addEventListener("message", handleMessage);
      });

      // Send coordinates to iframe via postMessage
      iframeElement.contentWindow?.postMessage(
        {
          type: "staktrak-debug-request",
          messageId,
          coordinates: { x, y, width, height },
        },
        new URL(content.url).origin,
      );

      // Wait for response from iframe
      const sourceFiles = await responsePromise;

      // Create BugReportContent artifact with PLACEHOLDER DATA
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

      // Create debug artifact
      const debugArtifact: Artifact = {
        id: `debug-${Date.now()}`,
        messageId: "", // Will be set by chat system
        type: ArtifactType.BUG_REPORT,
        content: bugReportContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Send artifact without visible chat message (debug attachment will appear directly)
      if (onDebugMessage) {
        await onDebugMessage("", debugArtifact); // Empty message - no chat bubble will be created
      }

      // Auto-disable debug mode after successful interaction
      setDebugMode(false);
    } catch (error) {
      console.error("Failed to process debug selection:", error);

      // Fallback: create debug artifact with error info
      const bugReportContent: BugReportContent = {
        bugDescription: `Debug ${width === 0 && height === 0 ? "click" : "selection"} failed - communication error with iframe`,
        iframeUrl: content.url,
        method: width === 0 && height === 0 ? "click" : "selection",
        sourceFiles: [
          {
            file: "Source mapping will be available in future update",
            lines: [],
            context: "Debug UI preview - actual source mapping implementation coming soon"
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
          // Keep debug mode active on error so user can retry
        }
      }
    } finally {
      setIsSubmittingDebug(false);
    }
  };

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col">
      {artifacts.length > 1 && (
        <div className="border-b bg-muted/20">
          <div className="flex overflow-x-auto">
            {artifacts.map((artifact, index) => (
              <button
                key={artifact.id}
                onClick={() => handleTabChange(index)}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === index
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Preview {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {artifacts.map((artifact, index) => {
          const content = artifact.content as BrowserContent;
          const isActive = activeTab === index;
          // For the active tab, use the tracked URL, for others use original URL
          const tabUrl = isActive ? displayUrl : content.url;

          return (
            <div
              key={artifact.id}
              className={`h-full flex flex-col ${isActive ? "block" : "hidden"}`}
            >
              {!ide && (
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {tabUrl}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isSetup && isRecording && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleAssertionToggle}
                              className={`h-8 w-8 p-0 ${
                                isAssertionMode
                                  ? "bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                                  : "hover:bg-accent hover:text-accent-foreground"
                              }`}
                            >
                              <Target className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {isAssertionMode
                              ? "Disable assertion mode"
                              : "Enable assertion mode"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {isSetup && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleRecordToggle}
                              className={`h-8 w-8 p-0 ${
                                isRecording
                                  ? "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
                                  : "hover:bg-accent hover:text-accent-foreground"
                              }`}
                            >
                              {isRecording ? (
                                <Square className="w-4 h-4" />
                              ) : (
                                <Circle className="w-4 h-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {isRecording ? "Stop recording" : "Start recording"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsTestModalOpen(true)}
                            className="h-8 w-8 p-0"
                          >
                            <FlaskConical className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Tests</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={debugMode ? "default" : "ghost"}
                            size="sm"
                            onClick={handleDebugElement}
                            className="h-8 w-8 p-0"
                            title="Debug Element"
                          >
                            <Bug className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Debug Element</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTabOut(tabUrl)}
                            className="h-8 w-8 p-0"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Open in new tab
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleRefresh}
                            className="h-8 w-8 p-0"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Refresh</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-hidden min-h-0 min-w-0 relative">
                <iframe
                  key={`${artifact.id}-${refreshKey}`}
                  ref={isActive ? iframeRef : undefined}
                  src={content.url}
                  className="w-full h-full border-0"
                  title={`Live Preview ${index + 1}`}
                />
                {/* Debug overlay - only active for the current tab */}
                {isActive && (
                  <DebugOverlay
                    isActive={debugMode}
                    isSubmitting={isSubmittingDebug}
                    onDebugSelection={handleDebugSelection}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <PlaywrightTestModal
        isOpen={showPlaywrightModal}
        onClose={closePlaywrightModal}
        playwrightTest={generatedPlaywrightTest}
      />

      <TestManagerModal
        isOpen={isTestModalOpen || showPlaywrightModal}
        onClose={() => {
          setIsTestModalOpen(false);
          if (showPlaywrightModal) closePlaywrightModal();
        }}
        generatedCode={generatedPlaywrightTest}
        initialTab={showPlaywrightModal ? "generated" : "saved"}
      />
    </div>
  );
}
