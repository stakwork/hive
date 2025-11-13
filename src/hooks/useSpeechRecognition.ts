import { useState, useEffect, useCallback, useRef } from "react";
import { logger } from "@/lib/logger";

interface SpeechRecognitionHook {
  isListening: boolean;
  transcript: string;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useSpeechRecognition(): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isStartingRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let finalTranscript = "";
          let interimTranscript = "";

          for (let i = 0; i < event.results.length; i++) {
            const transcriptPiece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcriptPiece + " ";
            } else {
              interimTranscript += transcriptPiece;
            }
          }

          setTranscript(finalTranscript + interimTranscript);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          logger.error("Speech recognition error:", "useSpeechRecognition", { event.error });
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
          isStartingRef.current = false;
        };

        recognition.onstart = () => {
          setIsListening(true);
          isStartingRef.current = false;
        };

        recognitionRef.current = recognition;
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isStartingRef.current) {
      setIsListening((current) => {
        if (!current && !isStartingRef.current) {
          isStartingRef.current = true;
          setTranscript("");
          try {
            recognitionRef.current?.start();
          } catch (error) {
            logger.error("Error starting speech recognition:", "useSpeechRecognition", { error });
            isStartingRef.current = false;
            return false;
          }
          return true;
        }
        return current;
      });
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      setIsListening((current) => {
        if (current) {
          isStartingRef.current = false;
          try {
            recognitionRef.current?.stop();
          } catch (error) {
            logger.error("Error stopping speech recognition:", "useSpeechRecognition", { error });
          }
          return false;
        }
        return current;
      });
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  };
}
