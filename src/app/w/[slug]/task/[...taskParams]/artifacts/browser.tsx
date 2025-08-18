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
} from "lucide-react";
import { Artifact, BrowserContent } from "@/lib/chat";
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

export function BrowserArtifactPanel({
  artifacts,
  ide,
}: {
  artifacts: Artifact[];
  ide?: boolean;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

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

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col">
      {artifacts.length > 1 && (
        <div className="border-b bg-muted/20">
          <div className="flex overflow-x-auto">
            {artifacts.map((artifact, index) => (
              <button
                key={artifact.id}
                onClick={() => setActiveTab(index)}
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
              <div className="flex-1 overflow-hidden min-h-0 min-w-0">
                <iframe
                  key={`${artifact.id}-${refreshKey}`}
                  ref={isActive ? iframeRef : undefined}
                  src={content.url}
                  className="w-full h-full border-0"
                  title={`Live Preview ${index + 1}`}
                />
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
