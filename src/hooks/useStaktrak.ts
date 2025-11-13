import { useEffect, useState, useRef } from "react";
import { logger } from "@/lib/logger";

type StaktrakMessageType =
  | "staktrak-setup"
  | "staktrak-results"
  | "staktrak-selection"
  | "staktrak-page-navigation"
  | "staktrak-event";

interface StaktrakMessageData {
  type: StaktrakMessageType;
  data?: unknown;
  eventType?: string;
}

interface StaktrakMessageEvent extends MessageEvent {
  data: StaktrakMessageData;
}

type StaktrakCommandType =
  | "staktrak-start"
  | "staktrak-stop"
  | "staktrak-enable-selection"
  | "staktrak-disable-selection";

function sendCommand(iframeRef: React.RefObject<HTMLIFrameElement | null>, command: StaktrakCommandType) {
  if (iframeRef?.current && iframeRef.current.contentWindow) {
    iframeRef.current.contentWindow.postMessage({ type: command }, "*");
  }
}

// RecordingManager type definition
interface RecordingManager {
  handleEvent(eventType: string, eventData: any): any;
  generateTest(url: string, options?: any): string;
  getActions(): any[];
  getTrackingData(): any;
  clear(): void;
  clearAllActions(): void;
  removeAction(actionId: string): boolean;
}

declare global {
  interface Window {
    PlaywrightGenerator?: {
      RecordingManager: new () => RecordingManager;
      generatePlaywrightTest: (url: string, trackingData: any) => string;
      generatePlaywrightTestFromActions: (actions: any[], options?: any) => string;
    };
  }
}

export const useStaktrak = (
  initialUrl?: string,
  onTestGenerated?: (test: string, error?: string) => void,
  onActionCaptured?: (type: string, text: string) => void,
) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl || null);
  const [isSetup, setIsSetup] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAssertionMode, setIsAssertionMode] = useState(false);
  const [capturedActions, setCapturedActions] = useState<any[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [isRecorderReady, setIsRecorderReady] = useState(false);

  const [generatedPlaywrightTest, setGeneratedPlaywrightTest] = useState<string>("");
  const [generationError, setGenerationError] = useState<string>("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recorderRef = useRef<RecordingManager | null>(null);
  const onTestGeneratedRef = useRef(onTestGenerated);
  const onActionCapturedRef = useRef(onActionCaptured);
  const recordingStartUrl = useRef<string | undefined>(undefined);

  // Keep callback refs up to date
  useEffect(() => {
    onTestGeneratedRef.current = onTestGenerated;
    onActionCapturedRef.current = onActionCaptured;
  }, [onTestGenerated, onActionCaptured]);

  // Initialize RecordingManager when PlaywrightGenerator is available
  useEffect(() => {
    if (window.PlaywrightGenerator?.RecordingManager && !recorderRef.current) {
      recorderRef.current = new window.PlaywrightGenerator.RecordingManager();
      setIsRecorderReady(true);
    }
  }, []);

  const startRecording = () => {
    // Capture the URL at recording start time to prevent it from becoming undefined
    recordingStartUrl.current = initialUrl;
    logger.debug("[useStaktrak] Starting recording", {
      hasRecorder: !!recorderRef.current,
      hasIframe: !!iframeRef.current,
      initialUrl,
      capturedUrl: recordingStartUrl.current,
    });
    // Clear existing recording data when starting a new recording
    if (recorderRef.current) {
      recorderRef.current.clear();
    }
    setCapturedActions([]);
    sendCommand(iframeRef, "staktrak-start");
    setIsRecording(true);
    setIsAssertionMode(false);
  };

  const stopRecording = () => {
    const actionsCount = recorderRef.current?.getActions().length || 0;
    logger.debug("[useStaktrak] Stopping recording", {
      actionsCount,
      hasRecorder: !!recorderRef.current,
      hasIframe: !!iframeRef.current,
      initialUrl,
      capturedUrl: recordingStartUrl.current,
    });
    sendCommand(iframeRef, "staktrak-stop");
    setIsRecording(false);
    setIsAssertionMode(false);
    setShowActions(false);
  };

  const enableAssertionMode = () => {
    setIsAssertionMode(true);
    sendCommand(iframeRef, "staktrak-enable-selection");
  };

  const disableAssertionMode = () => {
    setIsAssertionMode(false);
    sendCommand(iframeRef, "staktrak-disable-selection");
  };

  const removeAction = (action: any) => {
    if (recorderRef.current && action.id) {
      const success = recorderRef.current.removeAction(action.id);
      if (success) {
        setCapturedActions(recorderRef.current.getActions());
      }
    }
  };

  const clearAllActions = () => {
    if (recorderRef.current) {
      recorderRef.current.clearAllActions();
      setCapturedActions([]);
    }
  };

  const toggleActionsView = () => {
    setShowActions((prev) => !prev);
  };

  function cleanInitialUrl(url: string) {
    // Handle URLs like @https://fq5n7qeb-3000.workspaces.sphinx.chat
    // Extract port number and convert to localhost
    const workspaceMatch = url.match(/@?https?:\/\/[^-]+-(\d+)\.workspaces\.sphinx\.chat/);
    if (workspaceMatch) {
      const port = workspaceMatch[1];
      return `http://localhost:${port}`;
    }

    return url;
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }

      if (event.data && event.data.type) {
        const staktrakEvent = event as StaktrakMessageEvent;

        switch (staktrakEvent.data.type) {
          case "staktrak-setup":
            setIsSetup(true);
            break;

          case "staktrak-event":
            // Handle event-based recording with RecordingManager
            if (recorderRef.current && staktrakEvent.data.eventType && staktrakEvent.data.data) {
              try {
                recorderRef.current.handleEvent(staktrakEvent.data.eventType, staktrakEvent.data.data);
                // Update captured actions in real-time
                setCapturedActions(recorderRef.current.getActions());

                // Show notification for all action types
                if (onActionCapturedRef.current) {
                  const eventType = staktrakEvent.data.eventType;
                  const eventData = staktrakEvent.data.data as any;

                  let toastType = "";
                  let toastText = "";

                  switch (eventType) {
                    case "click":
                      toastType = "Click captured";
                      toastText = eventData.selectors?.text || eventData.selectors?.tagName || "Element";
                      break;

                    case "input":
                      toastType = "Input captured";
                      toastText = eventData.value || "Input field";
                      break;

                    case "form":
                      toastType = "Form change captured";
                      const formType = eventData.formType || "input";
                      if (formType === "checkbox" || formType === "radio") {
                        toastText = `${formType} ${eventData.checked ? "checked" : "unchecked"}`;
                      } else if (formType === "select") {
                        toastText = `Selected: ${eventData.text || eventData.value || "option"}`;
                      } else {
                        toastText = formType;
                      }
                      break;

                    case "nav":
                    case "navigation":
                      toastType = "Navigation captured";
                      toastText = eventData.url ? getRelativeUrl(eventData.url) : "Page navigation";
                      break;

                    case "assertion":
                      toastType = "Assertion captured";
                      toastText = `"${eventData.value || "Element"}"`;
                      break;

                    default:
                      toastType = `${eventType} captured`;
                      toastText = "Action recorded";
                  }

                  onActionCapturedRef.current(toastType, toastText);
                }
              } catch (error) {
                logger.error("Error handling staktrak event:", { error });
              }
            }
            break;

          case "staktrak-results":
            console.log("[useStaktrak] Received staktrak-results message");
            // Generate test from RecordingManager to respect removed actions
            // Clear any previous generation error
            setGenerationError("");

            // Validate prerequisites with specific error messages
            if (!recorderRef.current) {
              const errorMsg = "Failed to generate test. Please try again.";
              logger.error("[useStaktrak] Test generation failed - recorder not initialized", {
                recorderRef: !!recorderRef.current,
              });
              setGenerationError(errorMsg);
              if (onTestGeneratedRef.current) {
                onTestGeneratedRef.current("", errorMsg);
              }
              break;
            }

            // Use the URL captured at recording start (prevents undefined due to re-renders)
            const urlToUse = recordingStartUrl.current || initialUrl;

            if (!urlToUse) {
              const errorMsg = "Failed to generate test. Please try again.";
              logger.error("[useStaktrak] Test generation failed - no URL", { 
                recorderReady: !!recorderRef.current,
                initialUrl,
                recordingStartUrl: recordingStartUrl.current,
                capturedActionsCount: recorderRef.current?.getActions(  }).length || 0,
              });
              setGenerationError(errorMsg);
              if (onTestGeneratedRef.current) {
                onTestGeneratedRef.current("", errorMsg);
              }
              break;
            }

            // Check if any actions were recorded
            const actions = recorderRef.current.getActions();
            if (!actions || actions.length === 0) {
              const errorMsg = "No actions were recorded. Please interact with the page and try again.";
              logger.error("[useStaktrak] Test generation failed - no actions", {
                recorderReady: !!recorderRef.current,
                initialUrl: initialUrl ? "present" : "missing",
                actionsArray: actions,
              });
              setGenerationError(errorMsg);
              if (onTestGeneratedRef.current) {
                onTestGeneratedRef.current("", errorMsg);
              }
              break;
            }

            // All prerequisites met, attempt to generate test
            try {
              logger.debug("[useStaktrak] Generating Playwright test", { 
                url: urlToUse,
                initialUrl,
                recordingStartUrl: recordingStartUrl.current,
                actionsCount: actions.length,
                actionTypes: actions.map((a  }) => a.type),
              });

              const test = recorderRef.current.generateTest(cleanInitialUrl(urlToUse));

              if (!test || test.trim().length === 0) {
                const errorMsg = "Failed to generate test. Please try again.";
                logger.error("[useStaktrak] Test generation returned empty code");
                setGenerationError(errorMsg);
                if (onTestGeneratedRef.current) {
                  onTestGeneratedRef.current("", errorMsg);
                }
              } else {
                setGeneratedPlaywrightTest(test);
                logger.debug("[useStaktrak] Test generated successfully", {
                  codeLength: test.length,
                  actionsCount: actions.length,
                });
                // Call the callback if provided
                if (onTestGeneratedRef.current) {
                  onTestGeneratedRef.current(test);
                }
              }
            } catch (error) {
              const errorMsg = "Failed to generate test. Please try again.";
              logger.error("[useStaktrak] Test generation error", { 
                error,
                errorMessage: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                url: urlToUse,
                initialUrl,
                recordingStartUrl: recordingStartUrl.current,
                actionsCount: actions.length,
              });
              setGenerationError(errorMsg);
              if (onTestGeneratedRef.current) {
                onTestGeneratedRef.current("", errorMsg);
              }
            }
            break;

          case "staktrak-page-navigation":
            const newUrl = staktrakEvent.data.data as string;
            if (newUrl) {
              setCurrentUrl(newUrl);
            }
            break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [initialUrl]);

  const navigateToUrl = (url: string) => {
    if (iframeRef.current) {
      iframeRef.current.src = url;
      setCurrentUrl(url);
    }
  };

  return {
    currentUrl,
    isSetup,
    isRecording,
    isAssertionMode,
    iframeRef,
    startRecording,
    stopRecording,
    enableAssertionMode,
    disableAssertionMode,
    generatedPlaywrightTest,
    setGeneratedPlaywrightTest,
    generationError,
    capturedActions,
    showActions,
    removeAction,
    clearAllActions,
    toggleActionsView,
    isRecorderReady,
    navigateToUrl,
  };
};
