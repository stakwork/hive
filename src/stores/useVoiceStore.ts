import {
  type Participant,
  Room,
  RoomEvent,
  type TranscriptionSegment,
} from "livekit-client";
import { create } from "zustand";

export interface AgentMessage {
  id: string;
  timestamp: number;
  message: string;
}

interface Transcription {
  participantIdentity: string;
  text: string;
  isFinal: boolean;
}

interface VoiceState {
  // Connection
  room: Room | null;
  isConnected: boolean;
  isConnecting: boolean;
  isMicEnabled: boolean;
  error: string | null;

  // Data from agent
  messages: AgentMessage[];
  transcription: Transcription | null;

  // Actions
  connect: (slug: string) => Promise<void>;
  disconnect: () => void;
  toggleMic: () => Promise<void>;
  clearError: () => void;
}

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL!;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  room: null,
  isConnected: false,
  isConnecting: false,
  isMicEnabled: false,
  error: null,
  messages: [],
  transcription: null,

  connect: async (slug: string) => {
    if (get().isConnected || get().isConnecting) return;
    set({ isConnecting: true, error: null });

    try {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to get token" }));
        throw new Error(err.error || "Failed to get token");
      }
      const { token } = await res.json();

      const room = new Room();

      // Agent results arrive on the lk-chat-topic data channel
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "lk-chat-topic") return;
        try {
          const msg: AgentMessage = JSON.parse(new TextDecoder().decode(payload));
          set((s) => ({ messages: [...s.messages, msg] }));
        } catch {
          // ignore malformed messages
        }
      });

      // Live transcriptions from the agent
      room.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: Participant) => {
          const seg = segments[0];
          if (!seg) return;
          set({
            transcription: {
              participantIdentity: participant?.identity ?? "",
              text: seg.text,
              isFinal: seg.final,
            },
          });
        },
      );

      room.on(RoomEvent.Disconnected, () => {
        set({ isConnected: false, isConnecting: false, isMicEnabled: false, room: null });
      });

      await room.connect(LIVEKIT_URL, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      set({ room, isConnected: true, isConnecting: false, isMicEnabled: true });
    } catch (err) {
      set({
        isConnecting: false,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
  },

  disconnect: () => {
    const { room } = get();
    if (room) {
      room.disconnect();
    }
    set({
      room: null,
      isConnected: false,
      isConnecting: false,
      isMicEnabled: false,
      messages: [],
      transcription: null,
    });
  },

  toggleMic: async () => {
    const { room, isMicEnabled } = get();
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!isMicEnabled);
    set({ isMicEnabled: !isMicEnabled });
  },

  clearError: () => set({ error: null }),
}));
