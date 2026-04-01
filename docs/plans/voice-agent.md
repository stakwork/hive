# Hive Frontend Integration

This document describes how to connect the Hive Next.js frontend to the sphinx-voice agent via LiveKit. The agent handles all AI logic (wake word detection, intent classification, structured extraction, MCP tool calls). The frontend only needs to capture audio and display results.

## Architecture

```
Browser (Hive Next.js)          LiveKit Server          sphinx-voice agent
┌─────────────────────┐        ┌──────────────┐        ┌──────────────────┐
│ Zustand store        │◄──────│  Room         │◄──────│ Deepgram STT     │
│ - mic audio ────────►│──────►│  Data Channel │──────►│ Wake word detect  │
│ - agent messages ◄───│◄──────│              │◄──────│ Classify + Extract │
│ - transcriptions ◄───│◄──────│              │       │ MCP tool calls     │
└─────────────────────┘        └──────────────┘        └──────────────────┘
```

The Zustand store manages the LiveKit connection globally so the user can navigate anywhere in Hive without interrupting the voice session.

## Design Decisions

- **Room naming**: `hive-${slug}-${timestamp}` — each "Connect" creates a new room with a unique name. One agent instance auto-joins per room. Rooms are multi-user capable (future: invite other users).
- **Connection trigger**: Explicit button press on the calls page (replaces the old browser-based "Record" button).
- **Messages sidebar**: Toggleable right drawer (Sheet) on the calls page showing agent messages.
- **Message persistence**: In-memory only (v1) — messages are ephemeral and lost on refresh.
- **Global indicator**: Subtle indicator in the sidebar when a voice session is active.
- **Existing "Start Call"**: Kept alongside the new voice agent button.

## Dependencies

```bash
npm add livekit-client livekit-server-sdk jsonwebtoken
npm add -D @types/jsonwebtoken
```

Note: `zustand` is already installed (`^5.0.6`).

## 1. Backend: Token Endpoint

Create an API route that mints a LiveKit participant token. The agent will auto-join the room via LiveKit's agent dispatch.

### `src/app/api/livekit-token/route.ts`

Uses the middleware-based auth pattern (route defaults to "protected" — no `ROUTE_POLICIES` update needed).

```ts
import { AccessToken } from "livekit-server-sdk";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

export async function POST(req: NextRequest) {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { slug } = await req.json();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const roomName = `hive-${slug}-${Date.now()}`;
  const participantIdentity = userOrResponse.id;
  const participantName = context.userName || "User";

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      name: participantName,
      ttl: "24h",
    }
  );

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Mint a short-lived JWT for the agent to authenticate with the Hive MCP API
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json(
      { error: "JWT secret not configured" },
      { status: 500 }
    );
  }
  const hiveToken = jwt.sign({ slug }, jwtSecret, { expiresIn: "4h" });

  // Pass MCP server config via participant metadata so the agent can make
  // authenticated MCP calls on behalf of this user's workspace.
  at.metadata = JSON.stringify({
    mcpServers: [
      {
        name: "hive",
        url: process.env.HIVE_MCP_URL || "https://hive.sphinx.chat/mcp",
        token: hiveToken,
      },
    ],
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, roomName });
}
```

The agent reads `mcpServers` from participant metadata (`agent.ts:28-49`), so the user's auth context is passed through automatically.

## 2. Zustand Store

A global store that owns the LiveKit `Room` instance. Because it lives outside React's component tree, the connection survives page navigation.

### `src/stores/useVoiceStore.ts`

```ts
import {
  type RemoteParticipant,
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
      // 1. Get token from backend
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get token");
      }
      const { token } = await res.json();

      // 2. Create room and wire up listeners
      const room = new Room();

      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "lk-chat-topic") return;
        try {
          const msg: AgentMessage = JSON.parse(
            new TextDecoder().decode(payload)
          );
          set((s) => ({ messages: [...s.messages, msg] }));
        } catch {
          // ignore malformed messages
        }
      });

      room.on(
        RoomEvent.TranscriptionReceived,
        (
          segments: TranscriptionSegment[],
          participant?: RemoteParticipant
        ) => {
          const seg = segments[0];
          if (!seg) return;
          set({
            transcription: {
              participantIdentity: participant?.identity ?? "",
              text: seg.text,
              isFinal: seg.final,
            },
          });
        }
      );

      room.on(RoomEvent.Disconnected, () => {
        set({
          isConnected: false,
          isConnecting: false,
          isMicEnabled: false,
          room: null,
        });
      });

      // 3. Connect and publish mic
      await room.connect(LIVEKIT_URL, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      set({
        room,
        isConnected: true,
        isConnecting: false,
        isMicEnabled: true,
      });
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
```

## 3. UI Components

### Calls Page (`src/app/w/[slug]/calls/page.tsx`)

- Remove the old browser-based "Record" button and `useVoiceRecorder` hook
- Add a "Connect Voice" button that calls `useVoiceStore.connect(slug)`
- When connected, show mic toggle and disconnect buttons
- Add a button to toggle the messages drawer open/closed
- Keep the existing "Start Call" button

### Voice Messages Drawer (`src/components/voice/VoiceMessagesDrawer.tsx`)

- Uses shadcn `Sheet` with `side="right"` (matches `BugReportSlideout` pattern)
- Displays `messages` from the voice store as a scrollable list
- Shows live `transcription` at the bottom when available
- Each message renders markdown (feature links, task descriptions, plain text)

### Global Voice Indicator

- Small dot/icon in the left `Sidebar` component when `useVoiceStore.isConnected` is true
- Clicking it navigates to the calls page

## 4. Data Flow

### What the frontend sends

Nothing beyond raw microphone audio (handled automatically by LiveKit once `setMicrophoneEnabled(true)` is called).

### What the frontend receives

**Agent messages** on the `lk-chat-topic` data channel — JSON with this shape:

```ts
{
  id: string;       // UUID
  timestamp: number; // epoch ms
  message: string;   // markdown
}
```

The `message` field format depends on the intent (see `monitor.ts:124-132`):

| Intent     | Message format                                             |
| ---------- | ---------------------------------------------------------- |
| `feature`  | `Feature created: [title](https://hive.sphinx.chat/w/...)` |
| `task`     | `# Title\n\nDescription`                                   |
| `question` | Plain text answer                                          |

**Live transcriptions** via `RoomEvent.TranscriptionReceived` — real-time captions of what the agent is hearing from each participant.

## 5. Environment Variables

Add to `.env.local`:

```
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
JWT_SECRET=your-jwt-secret          # already on prod
HIVE_MCP_URL=https://your-hive-mcp-endpoint.com
```

`NEXT_PUBLIC_LIVEKIT_URL` is the only value exposed to the browser. All secrets stay server-side in the API route.

## 6. Multi-Source Architecture

This same agent serves as the single orchestrator for all input sources. Text-based integrations (Slack, WhatsApp, etc.) can connect as text-only LiveKit participants, publishing messages on the data channel. The agent processes everything through the same classify/extract/MCP pipeline.

```
Voice (Hive browser)  ──► LiveKit Room ──► sphinx-voice agent ──► MCP tools ──► Hive actions
Slack webhook adapter  ──►             ──►                     ──►           ──►
WhatsApp adapter       ──►             ──►                     ──►           ──►
```

One brain, many ears.
