import { useEffect, useRef } from "react";

interface UseControlKeyHoldOptions {
  onStart: () => void;
  onStop: () => void;
  key?: string;
  enabled?: boolean;
  holdDuration?: number;
}

export function useControlKeyHold({
  onStart,
  onStop,
  key = "Control",
  enabled = true,
  holdDuration = 500,
}: UseControlKeyHoldOptions) {
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);

  useEffect(() => {
    onStartRef.current = onStart;
    onStopRef.current = onStop;
  }, [onStart, onStop]);

  useEffect(() => {
    if (!enabled) return;

    let holdTimer: NodeJS.Timeout | null = null;
    let isHolding = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === key &&
        !e.repeat &&
        !isHolding &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        holdTimer = setTimeout(() => {
          isHolding = true;
          onStartRef.current();
        }, holdDuration);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === key) {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (isHolding) {
          isHolding = false;
          onStopRef.current();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [enabled, holdDuration, key]);
}
