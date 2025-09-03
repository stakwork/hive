"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Monitor, RefreshCw, ExternalLink, Circle, Square, Target, FlaskConical, Bug, Play, Pause } from "lucide-react";
import { Artifact, BrowserContent } from "@/lib/chat";
import { useStaktrak } from "@/hooks/useStaktrak";
import { usePlaywrightReplay } from "@/hooks/useStaktrakReplay";
import { TestManagerModal } from "./TestManagerModal";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DebugOverlay } from "@/components/DebugOverlay";
import { useDebugSelection } from "@/hooks/useDebugSelection";

export function BrowserArtifactPanel({
  artifacts,
  ide,
  onDebugMessage,
  onUserJourneySave,
}: {
  artifacts: Artifact[];
  ide?: boolean;
  onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
  onUserJourneySave?: (filename: string, generatedCode: string) => void;
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
    generatedPlaywrightTest,
    setGeneratedPlaywrightTest,
  } = useStaktrak(activeContent?.url);

  // Use playwright replay hook
  const { isPlaywrightReplaying, startPlaywrightReplay, stopPlaywrightReplay } = usePlaywrightReplay(iframeRef);

  // Use debug selection hook with iframeRef from staktrak
  const {
    debugMode,
    isSubmittingDebug,
    setDebugMode,
    handleDebugElement,
    handleDebugSelection: handleDebugSelectionHook,
  } = useDebugSelection({ onDebugMessage, iframeRef });
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

  const handleReplayToggle = () => {
    if (isPlaywrightReplaying) {
      stopPlaywrightReplay();
    } else if (generatedPlaywrightTest) {
      startPlaywrightReplay(generatedPlaywrightTest);
    }
  };

  // Tab change handler
  const handleTabChange = (newTab: number) => {
    setActiveTab(newTab);
    if (debugMode) {
      setDebugMode(false);
    }
  };

  // Wrapper to pass artifacts and activeTab to the hook's handleDebugSelection
  const handleDebugSelection = async (x: number, y: number, width: number, height: number) => {
    await handleDebugSelectionHook(x, y, width, height, artifacts, activeTab);
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
            <div key={artifact.id} className={`h-full flex flex-col ${isActive ? "block" : "hidden"}`}>
              {!ide && (
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{tabUrl}</span>
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
                            {isAssertionMode ? "Disable assertion mode" : "Enable assertion mode"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {generatedPlaywrightTest && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleReplayToggle}
                              className={`h-8 w-8 p-0 ${
                                isPlaywrightReplaying
                                  ? "bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-300 dark:hover:bg-orange-800"
                                  : "hover:bg-accent hover:text-accent-foreground"
                              }`}
                            >
                              {isPlaywrightReplaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {isPlaywrightReplaying ? "Stop replay" : "Start replay"}
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
                              {isRecording ? <Square className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {isRecording ? "Stop recording" : "Start recording"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {!onUserJourneySave && (
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
                    )}
                    {!onUserJourneySave && (
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
                    )}
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
                        <TooltipContent side="bottom">Open in new tab</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8 w-8 p-0">
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

      <TestManagerModal
        isOpen={isTestModalOpen}
        onClose={() => {
          setIsTestModalOpen(false);
          if (generatedPlaywrightTest) setGeneratedPlaywrightTest("");
        }}
        generatedCode={generatedPlaywrightTest}
        initialTab={"generated"}
        onUserJourneySave={onUserJourneySave}
      />
    </div>
  );
}
