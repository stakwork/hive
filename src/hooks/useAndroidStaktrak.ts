import { useState, useCallback, useRef, useEffect } from "react";

export interface AndroidSelector {
  resourceId?: string;
  accessibilityId?: string;
  text?: string;
  xpath?: string;
}

export interface AndroidTapCoordinates {
  x: number;
  y: number;
}

export type AndroidTapPayload = { selector: AndroidSelector } | AndroidTapCoordinates;

export interface AndroidTypePayload {
  selector: AndroidSelector;
  text: string;
  replace?: boolean;
}

export interface AndroidSwipePayload {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs?: number;
}

export interface AndroidSessionData {
  packageName: string;
  activity: string;
  deviceName: string;
}

export interface AndroidReplayStatus {
  status: "idle" | "started" | "progress" | "error" | "completed";
  current?: number;
  total?: number;
  action?: any;
  error?: string;
  screenshot?: string;
}

export interface AndroidStaktrakState {
  isRecording: boolean;
  isReplaying: boolean;
  capturedActions: any[];
  generatedScript: string;
  replayStatus: AndroidReplayStatus;
  sessionData: AndroidSessionData | null;
  error: string | null;
}

export const useAndroidStaktrak = (customServiceUrl?: string) => {
  const serviceUrl = customServiceUrl || process.env.NEXT_PUBLIC_STAKTRAK_ANDROID_URL || "http://localhost:4724";

  const [state, setState] = useState<AndroidStaktrakState>({
    isRecording: false,
    isReplaying: false,
    capturedActions: [],
    generatedScript: "",
    replayStatus: { status: "idle" },
    sessionData: null,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const clearError = () => setState((s) => ({ ...s, error: null }));

  const handleErrorResponse = async (res: Response, fallbackMessage: string) => {
    try {
      const data = await res.json();
      if (data.error) {
        let msg = data.error;
        if (data.details && Array.isArray(data.details)) {
          const detailStr = data.details.map((d: any) => `${d.path}: ${d.message}`).join(", ");
          msg += ` (${detailStr})`;
        }
        setState((s) => ({ ...s, error: msg }));
        throw new Error(msg);
      }
    } catch (e: any) {
      if (e.message) {
        setState((s) => ({ ...s, error: e.message }));
        throw e;
      }
    }
    setState((s) => ({ ...s, error: fallbackMessage }));
    throw new Error(fallbackMessage);
  };

  const fetchAction = async (endpoint: string, payload?: any) => {
    clearError();
    const headers: Record<string, string> = {};
    const options: RequestInit = { method: "POST" };

    if (payload) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }
    options.headers = headers;

    try {
      const res = await fetch(`${serviceUrl}${endpoint}`, options);
      if (!res.ok) {
        await handleErrorResponse(res, `Failed to execute ${endpoint}`);
      }
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Action failed");
      }
      return data;
    } catch (err: any) {
      setState((s) => ({
        ...s,
        error: err.message || `Network error executing ${endpoint}`,
      }));
      throw err;
    }
  };

  const startRecording = useCallback(
    async (overrides?: Partial<AndroidSessionData>) => {
      try {
        const data = await fetchAction("/session/start", overrides || {});
        setState((s) => ({
          ...s,
          isRecording: true,
          sessionData: data.session || null,
          capturedActions: [],
          generatedScript: "",
        }));
      } catch (e) {
        // error handled in fetchAction
      }
    },
    [serviceUrl],
  );

  const stopRecording = useCallback(
    async (teardown = false) => {
      try {
        const data = await fetchAction("/session/stop", { teardown });
        setState((s) => ({
          ...s,
          isRecording: false,
          capturedActions: data.actions || [],
          generatedScript: data.script || "",
          sessionData: data.session || s.sessionData,
        }));
      } catch (e) {
        // error handled in fetchAction
      }
    },
    [serviceUrl],
  );

  const tap = useCallback(async (payload: AndroidTapPayload) => fetchAction("/tap", payload), [serviceUrl]);

  const type = useCallback(async (payload: AndroidTypePayload) => fetchAction("/type", payload), [serviceUrl]);

  const swipe = useCallback(async (payload: AndroidSwipePayload) => fetchAction("/swipe", payload), [serviceUrl]);

  const back = useCallback(async () => fetchAction("/back"), [serviceUrl]);

  const home = useCallback(async () => fetchAction("/home"), [serviceUrl]);

  const replay = useCallback(
    async (payload: { actions?: any[]; script?: string }) => {
      clearError();

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setState((s) => ({
        ...s,
        isReplaying: true,
        replayStatus: { status: "started" },
      }));

      // Set up SSE listener
      const es = new EventSource(`${serviceUrl}/events`);
      eventSourceRef.current = es;

      es.addEventListener("replay", (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          setState((s) => {
            const newStatus: AndroidReplayStatus = {
              status: parsed.type,
              current: parsed.current,
              total: parsed.total,
              action: parsed.action,
              screenshot: parsed.screenshot,
            };

            if (parsed.type === "error") {
              newStatus.error = parsed.error;
            }

            // Close connection upon completion
            if (parsed.type === "completed" || parsed.type === "error") {
              es.close();
              eventSourceRef.current = null;
            }

            return {
              ...s,
              replayStatus: newStatus,
              isReplaying: parsed.type !== "completed" && parsed.type !== "error",
            };
          });
        } catch (err) {
          console.error("Failed to parse SSE event", err);
        }
      });

      es.onerror = (err) => {
        console.error("SSE Error:", err);
        es.close();
        eventSourceRef.current = null;
        setState((s) => ({
          ...s,
          isReplaying: false,
          error: "Lost connection to SSE stream",
        }));
      };

      try {
        await fetchAction("/session/replay", payload);
      } catch (err) {
        // Since replay is kicked off, an error starting it means we must cleanup
        es.close();
        eventSourceRef.current = null;
        setState((s) => ({
          ...s,
          isReplaying: false,
          replayStatus: { status: "error", error: (err as Error).message },
        }));
      }
    },
    [serviceUrl],
  );

  // Cleanup effect
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    tap,
    type,
    swipe,
    back,
    home,
    replay,
    clearError,
  };
};
