import { useState, useEffect, useCallback, useRef } from "react";

interface UseTranscriptChunkingProps {
  transcript: string;
  enabled: boolean;
  workspaceSlug?: string;
  minWords?: number;
  maxWords?: number;
  pauseDurationMs?: number;
}

const DEFAULT_MIN_WORDS = 15;
const DEFAULT_MAX_WORDS = 100;
const DEFAULT_PAUSE_DURATION_MS = 1500;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function useTranscriptChunking({
  transcript,
  enabled,
  workspaceSlug,
  minWords = DEFAULT_MIN_WORDS,
  maxWords = DEFAULT_MAX_WORDS,
  pauseDurationMs = DEFAULT_PAUSE_DURATION_MS,
}: UseTranscriptChunkingProps) {
  const [lastSentLength, setLastSentLength] = useState(0);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const pauseCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update timestamp when transcript changes
  useEffect(() => {
    if (transcript && enabled) {
      lastUpdateTimeRef.current = Date.now();
    }
  }, [transcript, enabled]);

  // Function to send a chunk to the server
  const sendChunk = useCallback(
    async (chunk: string) => {
      if (!workspaceSlug) return;

      const wordCount = countWords(chunk);
      const containsKeyword = /\bhive\b/i.test(chunk);
      
      try {
        await fetch("/api/transcript/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chunk,
            wordCount,
            workspaceSlug,
            containsKeyword,
          }),
        });
      } catch (error) {
        console.error("Error sending transcript chunk:", error);
      }
    },
    [workspaceSlug]
  );

  // Check if we should send a chunk based on pause and word count
  const checkAndSendChunk = useCallback(async () => {
    if (!enabled || !transcript) return;

    const unsentText = transcript.substring(lastSentLength);
    const wordCount = countWords(unsentText);
    const timeSinceLastUpdate = Date.now() - lastUpdateTimeRef.current;

    // Send if max words reached
    if (wordCount >= maxWords) {
      await sendChunk(unsentText);
      setLastSentLength(transcript.length);
      return;
    }

    // Send if pause detected and min words met
    if (timeSinceLastUpdate >= pauseDurationMs && wordCount >= minWords) {
      await sendChunk(unsentText);
      setLastSentLength(transcript.length);
    }
  }, [enabled, transcript, lastSentLength, sendChunk, minWords, maxWords, pauseDurationMs]);

  // Set up interval to check for pauses
  useEffect(() => {
    if (enabled) {
      pauseCheckIntervalRef.current = setInterval(checkAndSendChunk, 500);
    } else {
      if (pauseCheckIntervalRef.current) {
        clearInterval(pauseCheckIntervalRef.current);
        pauseCheckIntervalRef.current = null;
      }
    }

    return () => {
      if (pauseCheckIntervalRef.current) {
        clearInterval(pauseCheckIntervalRef.current);
      }
    };
  }, [enabled, checkAndSendChunk]);

  // Reset tracking when enabled changes
  useEffect(() => {
    if (enabled) {
      setLastSentLength(0);
    }
  }, [enabled]);

  return {
    lastSentLength,
  };
}
