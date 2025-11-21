import { useState, useEffect, useCallback, useRef } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";

interface TranscriptChunk {
  text: string;
  timestamp: number;
}

interface VoiceRecorderHook {
  isRecording: boolean;
  isSupported: boolean;
  transcriptBuffer: TranscriptChunk[];
  currentTranscript: string;
  startRecording: () => void;
  stopRecording: () => void;
  getRecentTranscript: (minutes: number) => string;
  clearBuffer: () => void;
}

const BUFFER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_CONTEXT_MINUTES = 60; // Default minutes of context to analyze for features (1 hour)
const DEFAULT_MIN_WORDS = 15;
const DEFAULT_MAX_WORDS = 100;
const DEFAULT_PAUSE_DURATION_MS = 1500;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function useVoiceRecorder(): VoiceRecorderHook {
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const [transcriptBuffer, setTranscriptBuffer] = useState<TranscriptChunk[]>([]);
  const lastChunkedLengthRef = useRef(0);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const pauseCheckIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const bufferCleanupIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Update timestamp when transcript changes
  useEffect(() => {
    if (transcript && isListening) {
      lastUpdateTimeRef.current = Date.now();
    }
  }, [transcript, isListening]);

  // Check if we should create a new chunk based on pause and word count
  const checkAndCreateChunk = useCallback(() => {
    if (!isListening || !transcript) return;

    const unsentText = transcript.substring(lastChunkedLengthRef.current);
    const wordCount = countWords(unsentText);
    const timeSinceLastUpdate = Date.now() - lastUpdateTimeRef.current;

    let shouldChunk = false;

    // Create chunk if max words reached
    if (wordCount >= DEFAULT_MAX_WORDS) {
      shouldChunk = true;
    }

    // Create chunk if pause detected and min words met
    if (timeSinceLastUpdate >= DEFAULT_PAUSE_DURATION_MS && wordCount >= DEFAULT_MIN_WORDS) {
      shouldChunk = true;
    }

    if (shouldChunk && unsentText.trim()) {
      const chunk: TranscriptChunk = {
        text: unsentText.trim(),
        timestamp: Date.now(),
      };

      setTranscriptBuffer((prev) => {
        const updated = [...prev, chunk];
        // Prune old entries outside 10-minute window
        const cutoff = Date.now() - BUFFER_WINDOW_MS;
        return updated.filter((c) => c.timestamp > cutoff);
      });

      lastChunkedLengthRef.current = transcript.length;
    }
  }, [isListening, transcript]);

  // Set up interval to check for pauses and create chunks
  useEffect(() => {
    if (isListening) {
      pauseCheckIntervalRef.current = setInterval(checkAndCreateChunk, 500);
    } else {
      if (pauseCheckIntervalRef.current) {
        clearInterval(pauseCheckIntervalRef.current);
        pauseCheckIntervalRef.current = undefined;
      }
    }

    return () => {
      if (pauseCheckIntervalRef.current) {
        clearInterval(pauseCheckIntervalRef.current);
      }
    };
  }, [isListening, checkAndCreateChunk]);

  // Periodic cleanup of old buffer entries
  useEffect(() => {
    if (isListening) {
      bufferCleanupIntervalRef.current = setInterval(() => {
        const cutoff = Date.now() - BUFFER_WINDOW_MS;
        setTranscriptBuffer((prev) => prev.filter((c) => c.timestamp > cutoff));
      }, 30000); // Clean up every 30 seconds

      return () => {
        if (bufferCleanupIntervalRef.current) {
          clearInterval(bufferCleanupIntervalRef.current);
        }
      };
    }
  }, [isListening]);

  const handleStartRecording = useCallback(() => {
    lastChunkedLengthRef.current = 0;
    lastUpdateTimeRef.current = Date.now();
    setTranscriptBuffer([]);
    startListening();
  }, [startListening]);

  const handleStopRecording = useCallback(() => {
    // Create final chunk from any remaining transcript
    if (transcript) {
      const unsentText = transcript.substring(lastChunkedLengthRef.current);
      if (unsentText.trim() && countWords(unsentText) > 0) {
        const chunk: TranscriptChunk = {
          text: unsentText.trim(),
          timestamp: Date.now(),
        };
        setTranscriptBuffer((prev) => [...prev, chunk]);
      }
    }

    stopListening();
    resetTranscript();
  }, [stopListening, resetTranscript, transcript]);

  // Get transcript from the last N minutes
  const getRecentTranscript = useCallback(
    (minutes: number): string => {
      const cutoff = Date.now() - minutes * 60 * 1000;
      const recentChunks = transcriptBuffer.filter((c) => c.timestamp > cutoff);
      return recentChunks.map((c) => c.text).join(" ");
    },
    [transcriptBuffer],
  );

  const clearBuffer = useCallback(() => {
    setTranscriptBuffer([]);
    lastChunkedLengthRef.current = 0;
  }, []);

  return {
    isRecording: isListening,
    isSupported,
    transcriptBuffer,
    currentTranscript: transcript,
    startRecording: handleStartRecording,
    stopRecording: handleStopRecording,
    getRecentTranscript,
    clearBuffer,
  };
}
