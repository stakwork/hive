"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Monitor,
  RefreshCw,
  ExternalLink,
  Circle,
  Square,
  Target,
  FlaskConical,
  Bug,
  List,
  CheckCircle2,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Artifact, BrowserContent } from "@/lib/chat";
import { useStaktrak } from "@/hooks/useStaktrak";
import { usePlaywrightReplay } from "@/hooks/useStaktrakReplay";
import { TestManagerModal } from "./TestManagerModal";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DebugOverlay } from "@/components/DebugOverlay";
import { useDebugSelection } from "@/hooks/useDebugSelection";
import { ActionsList } from "@/components/ActionsList";

export function BrowserArtifactPanel({
  artifacts,
  ide,
  workspaceId,
  taskId,
  onDebugMessage,
  onUserJourneySave,
  externalTestCode,
  externalTestTitle,
  isMobile = false,
}: {
  artifacts: Artifact[];
  ide?: boolean;
  workspaceId?: string;
  taskId?: string;
  onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
  onUserJourneySave?: (filename: string, generatedCode: string) => void;
  externalTestCode?: string | null;
  externalTestTitle?: string | null;
  isMobile?: boolean;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionToast, setActionToast] = useState<{ type: string; text: string; id: number } | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUrlReady, setIsUrlReady] = useState<Record<string, boolean>>({});
  const [urlCheckAttempts, setUrlCheckAttempts] = useState<Record<string, number>>({});

  // Get the current artifact and its content
  const activeArtifact = artifacts[activeTab];
  const activeContent = activeArtifact?.content as BrowserContent;

  // Local toast handler for all action types
  const showActionToast = useCallback((type: string, text: string) => {
    const id = Date.now();
    setActionToast({ type, text, id });
    setTimeout(() => {
      setActionToast(null);
    }, 3000);
  }, []);

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
    capturedActions,
    showActions,
    removeAction,
    clearAllActions,
    toggleActionsView,
    isRecorderReady,
    navigateToUrl,
  } = useStaktrak(
    activeContent?.url,
    () => {
      // Open modal when test is generated
      setIsTestModalOpen(true);
    },
    showActionToast,
  );

  // Use playwright replay hook
  const {
    isPlaywrightReplaying,
    playwrightProgress,
    currentAction,
    startPlaywrightReplay,
    stopPlaywrightReplay,
    replayScreenshots,
    replayActions,
  } = usePlaywrightReplay(iframeRef, workspaceId, taskId, (message) => {
    showActionToast("Screenshot Error", message);
  });

  // Auto-show actions list when replay starts
  useEffect(() => {
    if (isPlaywrightReplaying && !showActions && (replayActions.length > 0 || capturedActions.length > 0)) {
      toggleActionsView();
    }
  }, [isPlaywrightReplaying, showActions, toggleActionsView]);

  // Auto-show actions list when recording starts
  useEffect(() => {
    if (isRecording && !showActions) {
      toggleActionsView();
    }
  }, [isRecording, showActions, toggleActionsView]);

  // Auto-show actions list when externalTestCode is loaded and recorder is ready
  useEffect(() => {
    if (externalTestCode && isSetup && isRecorderReady && !showActions) {
      toggleActionsView();
    }
  }, [externalTestCode, isSetup, isRecorderReady, showActions, toggleActionsView]);

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

  // Track navigation history when URL changes
  useEffect(() => {
    if (displayUrl && displayUrl !== navigationHistory[historyIndex]) {
      // If we're not at the end of history, truncate forward history
      const newHistory = navigationHistory.slice(0, historyIndex + 1);
      newHistory.push(displayUrl);
      setNavigationHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [displayUrl]);

  // Sync urlInput with displayUrl
  useEffect(() => {
    setUrlInput(displayUrl || "");
  }, [displayUrl]);

  // Poll URL to check if it's ready (only on initial load for each artifact)
  useEffect(() => {
    const url = activeContent?.url;
    if (!url) return;

    // If we already know this URL is ready, don't poll
    if (isUrlReady[url]) return;

    const maxAttempts = 30; // 30 attempts = 30 seconds max
    const pollInterval = 1000; // 1 second

    const checkUrl = async () => {
      try {
        const response = await fetch(url, { 
          method: 'HEAD',
          mode: 'no-cors', // Allow checking cross-origin URLs
        });
        // With no-cors mode, we can't read the status, but if fetch succeeds, URL is likely ready
        setIsUrlReady(prev => ({ ...prev, [url]: true }));
        setUrlCheckAttempts(prev => ({ ...prev, [url]: 0 }));
      } catch (error) {
        // URL not ready yet, increment attempts
        setUrlCheckAttempts(prev => {
          const currentAttempts = (prev[url] || 0) + 1;
          
          if (currentAttempts >= maxAttempts) {
            // Give up after max attempts and show iframe anyway
            setIsUrlReady(prevReady => ({ ...prevReady, [url]: true }));
            return { ...prev, [url]: 0 };
          }
          
          return { ...prev, [url]: currentAttempts };
        });
      }
    };

    // Initial check
    checkUrl();

    // Set up polling
    const intervalId = setInterval(() => {
      if (!isUrlReady[url] && (urlCheckAttempts[url] || 0) < maxAttempts) {
        checkUrl();
      } else {
        clearInterval(intervalId);
      }
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [activeContent?.url, isUrlReady, urlCheckAttempts]);

  const handleUrlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrlInput(e.target.value);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput && navigateToUrl) {
      navigateToUrl(urlInput);
    }
  };

  const handleBack = () => {
    if (historyIndex > 0 && navigateToUrl) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      navigateToUrl(navigationHistory[newIndex]);
    }
  };

  const canGoBack = historyIndex > 0;

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleTabOut = (url: string) => {
    window.open(url, "_blank");
  };

  const handleRecordToggle = () => {
    if (isRecording) {
      stopRecording();
      // Modal will open automatically when test is generated (via callback)
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
    } else {
      // Use externalTestCode if available, otherwise use generated test
      const testCode = externalTestCode || generatedPlaywrightTest;
      if (testCode) {
        startPlaywrightReplay(testCode);
      }
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
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBack}
                            disabled={!isActive || !canGoBack}
                            className="h-7 w-7 p-0 flex-shrink-0"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Go back</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {/* <Monitor className="w-4 h-4 flex-shrink-0" /> */}
                    <form onSubmit={handleUrlSubmit} className="flex-1 min-w-0">
                      <Input
                        type="text"
                        value={isActive ? urlInput : tabUrl}
                        onChange={handleUrlInputChange}
                        onFocus={(e) => e.target.select()}
                        disabled={!isActive}
                        className="h-7 text-sm"
                        placeholder="Enter URL..."
                      />
                    </form>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isSetup &&
                      isRecorderReady &&
                      (isRecording || isPlaywrightReplaying || capturedActions.length > 0) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={toggleActionsView}
                                className={`h-8 w-8 p-0 ${
                                  showActions
                                    ? "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                    : "hover:bg-accent hover:text-accent-foreground"
                                }`}
                              >
                                <List className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              {showActions ? "Hide" : "Show"} Actions ({capturedActions.length})
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    {isSetup && isRecorderReady && isRecording && (
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

                    {isSetup && isRecorderReady && (
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

                    {!onUserJourneySave && !isMobile && (
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
                    {!onUserJourneySave && !isMobile && (
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
              {showActions && (
                <div className="fixed top-0 left-0 bottom-0 z-40 w-80 transition-all duration-300 ease-in-out">
                  <ActionsList
                    actions={replayActions.length > 0 ? replayActions : capturedActions}
                    onRemoveAction={removeAction}
                    onClearAll={clearAllActions}
                    isRecording={isRecording}
                    isReplaying={isPlaywrightReplaying}
                    currentActionIndex={playwrightProgress.current - 1}
                    totalActions={playwrightProgress.total}
                    screenshots={replayScreenshots}
                    title={externalTestTitle || undefined}
                    onReplayToggle={(generatedPlaywrightTest || externalTestCode) ? handleReplayToggle : undefined}
                  />
                </div>
              )}
              <div className="flex-1 overflow-hidden min-h-0 min-w-0 relative">
                {isActive && !isUrlReady[content.url] && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Waiting for server to be ready...</p>
                    </div>
                  </div>
                )}
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
                {/* Action toast - only active for the current tab */}
                {isActive && actionToast && (
                  <div className="absolute bottom-4 right-4 z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-background/95 backdrop-blur-sm p-4 shadow-lg">
                      <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      <div className="flex flex-col gap-1">
                        <div className="font-semibold text-sm text-foreground">{actionToast.type}</div>
                        <div className="text-sm text-muted-foreground">{actionToast.text}</div>
                      </div>
                    </div>
                  </div>
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
        }}
        generatedCode={generatedPlaywrightTest}
        initialTab={"generated"}
        onUserJourneySave={onUserJourneySave}
      />
    </div>
  );
}
