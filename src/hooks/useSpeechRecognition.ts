import { useState, useEffect, useCallback, useRef } from "react";

interface SpeechRecognitionHook {
  isListening: boolean;
  transcript: string;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

interface SpeechRecognitionOptions {
  autoRestart?: boolean; // Auto-restart when browser stops due to silence
}

export function useSpeechRecognition(
  options: SpeechRecognitionOptions = {}
): SpeechRecognitionHook {
  const { autoRestart = false } = options;
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
          console.error("🎤❌ Speech recognition error:", event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          console.log("🎤🛑 Speech recognition ended");

          // Auto-restart if enabled and we're supposed to be listening
          if (autoRestart && !isStartingRef.current && recognitionRef.current) {
            console.log("🔄 Auto-restarting speech recognition");
            try {
              recognitionRef.current.start();
              isStartingRef.current = true;
              return; // Don't set isListening to false
            } catch (error) {
              console.error("Failed to auto-restart:", error);
            }
          }

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
  }, [autoRestart]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isStartingRef.current) {
      setIsListening((current) => {
        if (!current && !isStartingRef.current) {
          isStartingRef.current = true;
          setTranscript("");
          try {
            recognitionRef.current?.start();
          } catch (error) {
            console.error("Error starting speech recognition:", error);
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
            console.error("Error stopping speech recognition:", error);
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
