"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Mic, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const SCRIPTED_PROMPT = `I am recording this audio to create a baseline voice signature for speaker diarization. To ensure the system accurately maps my unique vocal characteristics, I will now read a series of phonetically balanced phrases at my natural speaking pace.

The birch canoe slid on the smooth planks.
Glue the sheet to the dark blue background.
It's easy to tell the depth of a well.
These days a chicken leg is a rare dish.
Rice is often served in round bowls.
The juice of lemons makes fine punch.
The box was thrown beside the parked truck.
The hogs were fed chopped corn and garbage.
Four hours of steady work faced us.
A large size in stockings is hard to sell.

This completes my voice sample. The variation in these words should provide enough acoustic data to build an accurate and robust speaker profile.`;

type RecordingState = "idle" | "recording" | "review" | "saving";

export function VoiceSignatureSettings() {
  const { data: session, update } = useSession();
  const [state, setState] = useState<RecordingState>("idle");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const hasVoiceSignature = !!(session?.user as { hasVoiceSignature?: boolean })?.hasVoiceSignature;

  // Cleanup function
  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioBlobUrl) {
      URL.revokeObjectURL(audioBlobUrl);
      setAudioBlobUrl(null);
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  };

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Check for audio/wav support, fallback to audio/webm
      const mimeType = MediaRecorder.isTypeSupported("audio/wav")
        ? "audio/wav"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioBlobUrl(url);
        setState("review");
      };

      mediaRecorder.start();
      setState("recording");
      setElapsedTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("Microphone access error:", error);
      toast.error("Microphone access denied. Please allow microphone access and try again.");
      setState("idle");
      cleanup();
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Re-record
  const handleReRecord = () => {
    if (audioBlobUrl) {
      URL.revokeObjectURL(audioBlobUrl);
      setAudioBlobUrl(null);
    }
    setAudioBlob(null);
    setElapsedTime(0);
    audioChunksRef.current = [];
    startRecording();
  };

  // Convert webm to WAV using Web Audio API
  const convertToWav = async (blob: Blob): Promise<Blob> => {
    // If already WAV, return as-is
    if (blob.type === "audio/wav") {
      return blob;
    }

    const audioContext = new AudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Convert AudioBuffer to WAV
    const wavBuffer = audioBufferToWav(audioBuffer);
    return new Blob([wavBuffer], { type: "audio/wav" });
  };

  // Encode AudioBuffer to WAV format
  const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
    const length = buffer.length * buffer.numberOfChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);
    const channels: Float32Array[] = [];
    let offset = 0;
    let pos = 0;

    // Write WAV header
    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };
    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    // RIFF identifier
    setUint32(0x46464952);
    // file length minus RIFF identifier length and file description length
    setUint32(length - 8);
    // RIFF type
    setUint32(0x45564157);
    // format chunk identifier
    setUint32(0x20746d66);
    // format chunk length
    setUint32(16);
    // sample format (raw)
    setUint16(1);
    // channel count
    setUint16(buffer.numberOfChannels);
    // sample rate
    setUint32(buffer.sampleRate);
    // byte rate (sample rate * block align)
    setUint32(buffer.sampleRate * buffer.numberOfChannels * 2);
    // block align (channel count * bytes per sample)
    setUint16(buffer.numberOfChannels * 2);
    // bits per sample
    setUint16(16);
    // data chunk identifier
    setUint32(0x61746164);
    // data chunk length
    setUint32(length - pos - 4);

    // Write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return arrayBuffer;
  };

  // Save recording
  const handleSave = async () => {
    if (!audioBlob) return;

    setState("saving");

    try {
      // Convert to WAV if needed
      const wavBlob = await convertToWav(audioBlob);

      // Step 1: Get presigned URL
      const uploadResponse = await fetch("/api/user/voice-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: "audio/wav",
          size: wavBlob.size,
        }),
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to get upload URL");
      }

      const { presignedUrl, s3Path } = await uploadResponse.json();

      // Step 2: Upload to S3
      const uploadToS3Response = await fetch(presignedUrl, {
        method: "PUT",
        body: wavBlob,
        headers: {
          "Content-Type": "audio/wav",
        },
      });

      if (!uploadToS3Response.ok) {
        throw new Error("Failed to upload to S3");
      }

      // Step 3: Confirm upload
      const confirmResponse = await fetch("/api/user/voice-signature/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Path }),
      });

      if (!confirmResponse.ok) {
        throw new Error("Failed to confirm upload");
      }

      // Step 4: Refresh session
      await update();

      // Cleanup and close
      cleanup();
      setState("idle");
      setAudioBlob(null);
      toast.success("Voice signature saved.");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save voice signature. Please try again.");
      setState("review");
    }
  };

  // Delete voice signature
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch("/api/user/voice-signature", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete voice signature");
      }

      await update();
      toast.success("Voice signature deleted.");
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete voice signature. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Close modal handler
  const handleCloseModal = () => {
    if (state === "recording") {
      stopRecording();
    }
    cleanup();
    setState("idle");
    setAudioBlob(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Voice Signature
          </CardTitle>
          <CardDescription>
            Record a voice sample for speaker diarization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              {hasVoiceSignature ? (
                <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                  Voice signature on file
                </Badge>
              ) : (
                <Badge variant="secondary">No voice signature</Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={startRecording} disabled={state !== "idle"}>
              <Mic className="w-4 h-4 mr-2" />
              Record
            </Button>
            {hasVoiceSignature && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={state !== "idle"} onOpenChange={(open) => !open && handleCloseModal()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {state === "recording" && "Recording Voice Signature"}
              {state === "review" && "Review Recording"}
              {state === "saving" && "Saving..."}
            </DialogTitle>
            <DialogDescription>
              {state === "recording" && "Read the prompt below clearly at your natural pace"}
              {state === "review" && "Listen to your recording and save or re-record"}
              {state === "saving" && "Uploading your voice signature..."}
            </DialogDescription>
          </DialogHeader>

          {state === "recording" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-lg font-mono">{formatTime(elapsedTime)}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-4 bg-muted rounded-lg">
                <p className="text-sm whitespace-pre-line leading-relaxed">
                  {SCRIPTED_PROMPT}
                </p>
              </div>
            </div>
          )}

          {state === "review" && audioBlobUrl && (
            <div className="space-y-4">
              <audio controls src={audioBlobUrl} className="w-full" />
            </div>
          )}

          <DialogFooter>
            {state === "recording" && (
              <Button onClick={stopRecording}>Done</Button>
            )}
            {state === "review" && (
              <>
                <Button variant="outline" onClick={handleReRecord}>
                  Re-record
                </Button>
                <Button onClick={handleSave}>Save</Button>
              </>
            )}
            {state === "saving" && (
              <Button disabled>
                <span className="mr-2">Saving...</span>
                <span className="animate-spin">⏳</span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
