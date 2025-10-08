import { useEffect, useState, useRef } from "react";

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
  onTestGenerated?: (test: string) => void,
  onActionCaptured?: (type: string, text: string) => void
) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl || null);
  const [isSetup, setIsSetup] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAssertionMode, setIsAssertionMode] = useState(false);
  const [capturedActions, setCapturedActions] = useState<any[]>([]);
  const [showActions, setShowActions] = useState(false);

  const [generatedPlaywrightTest, setGeneratedPlaywrightTest] = useState<string>("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recorderRef = useRef<RecordingManager | null>(null);
  const onTestGeneratedRef = useRef(onTestGenerated);
  const onActionCapturedRef = useRef(onActionCaptured);

  // Keep callback refs up to date
  useEffect(() => {
    onTestGeneratedRef.current = onTestGenerated;
    onActionCapturedRef.current = onActionCaptured;
  }, [onTestGenerated, onActionCaptured]);

  const startRecording = () => {
    // Lazy initialize RecordingManager on first recording
    if (!recorderRef.current && window.PlaywrightGenerator?.RecordingManager) {
      recorderRef.current = new window.PlaywrightGenerator.RecordingManager();
    }

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
    sendCommand(iframeRef, "staktrak-stop");
    setIsRecording(false);
    setIsAssertionMode(false);
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
    setShowActions(prev => !prev);
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
                      toastText = eventData.url || "Page navigation";
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
                console.error("Error handling staktrak event:", error);
              }
            }
            break;

          case "staktrak-results":
            // Generate test from RecordingManager to respect removed actions
            if (recorderRef.current && initialUrl) {
              try {
                const test = recorderRef.current.generateTest(cleanInitialUrl(initialUrl));
                setGeneratedPlaywrightTest(test);
                // Call the callback if provided
                if (onTestGeneratedRef.current) {
                  onTestGeneratedRef.current(test);
                }
              } catch (error) {
                console.error("Error generating Playwright test:", error);
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
    capturedActions,
    showActions,
    removeAction,
    clearAllActions,
    toggleActionsView,
  };
};
