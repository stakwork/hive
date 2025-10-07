import { useEffect, useState, useRef } from "react";

type StaktrakMessageType = "staktrak-setup" | "staktrak-results" | "staktrak-selection" | "staktrak-page-navigation";

interface StaktrakMessageData {
  type: StaktrakMessageType;
  data?: unknown;
}

interface StaktrakMessageEvent extends MessageEvent {
  data: StaktrakMessageData;
}

type StaktrakCommandType =
  | "staktrak-start"
  | "staktrak-stop"
  | "staktrak-enable-selection"
  | "staktrak-disable-selection";

// Updated interfaces to match the new structure
interface ClickDetail {
  x: number;
  y: number;
  timestamp: number;
  selectors: {
    primary: string;
    fallbacks: string[];
    text?: string;
    ariaLabel?: string;
    title?: string;
    role?: string;
    tagName: string;
    xpath?: string;
  };
  elementInfo: {
    tagName: string;
    id?: string;
    className?: string;
    attributes: Record<string, string>;
  };
}

interface PlaywrightTrackingData {
  clicks?: {
    clickCount: number;
    clickDetails: ClickDetail[]; // Changed from number[][]
  };
  inputChanges?: Array<{
    elementSelector: string;
    value: string;
    action?: string;
    timestamp: number;
  }>;
  assertions?: Array<{
    type: string;
    selector: string;
    value: string;
    timestamp: number;
  }>;
  userInfo?: {
    windowSize: [number, number];
  };
  formElementChanges?: Array<{
    elementSelector: string;
    type: string;
    value: string;
    checked?: boolean;
    text?: string;
    timestamp: number;
  }>;
  focusChanges?: unknown[];
  // Add other properties that might be in the results
  pageNavigation?: Array<{
    type: string;
    url: string;
    timestamp: number;
  }>;
  keyboardActivities?: Array<[string, number]>;
  mouseMovement?: Array<[number, number, number]>;
  mouseScroll?: Array<[number, number, number]>;
  visibilitychanges?: Array<[string, number]>;
  windowSizes?: Array<[number, number, number]>;
  touchEvents?: Array<{
    type: string;
    x: number;
    y: number;
    timestamp: number;
  }>;
  audioVideoInteractions?: unknown[];
  time?: {
    startedAt: number;
    completedAt: number;
    totalSeconds: number;
  };
}

function sendCommand(iframeRef: React.RefObject<HTMLIFrameElement | null>, command: StaktrakCommandType) {
  console.log("Sending command:", command);
  if (iframeRef?.current && iframeRef.current.contentWindow) {
    iframeRef.current.contentWindow.postMessage({ type: command }, "*");
  }
}

declare global {
  interface Window {
    PlaywrightGenerator?: {
      generatePlaywrightTest: (url: string, trackingData: PlaywrightTrackingData) => string;
    };
  }
}

export const useStaktrak = (initialUrl?: string) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl || null);
  const [isSetup, setIsSetup] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAssertionMode, setIsAssertionMode] = useState(false);

  const [generatedPlaywrightTest, setGeneratedPlaywrightTest] = useState<string>("");

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // No longer need to inject scripts - staktrak.js handles its own React detection

  const startRecording = () => {
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
      // console.log("****** message received:", event.data);
      if (event.data && event.data.type) {
        const staktrakEvent = event as StaktrakMessageEvent;

        switch (staktrakEvent.data.type) {
          case "staktrak-setup":
            setIsSetup(true);
            break;
          case "staktrak-results":
            console.log("Staktrak results:", staktrakEvent.data.data);

            // Generate Playwright test when results are received
            if (window.PlaywrightGenerator && initialUrl) {
              try {
                const playwrightTest = window.PlaywrightGenerator.generatePlaywrightTest(
                  cleanInitialUrl(initialUrl),
                  staktrakEvent.data.data as PlaywrightTrackingData,
                );
                setGeneratedPlaywrightTest(playwrightTest);
              } catch (error) {
                console.error("Error generating Playwright test:", error);
                // You might want to show an error message to the user here
              }
            }
            break;
          case "staktrak-selection":
            // TODO: Handle staktrak selection
            console.log("Staktrak selection:", staktrakEvent.data.data);
            break;
          case "staktrak-page-navigation":
            console.log("Staktrak page navigation:", staktrakEvent.data.data);
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
  };
};
