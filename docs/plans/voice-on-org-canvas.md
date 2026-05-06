# Voice on the Org Canvas

Collapse the standalone LiveKit voice agent into the existing org-canvas chat by treating live transcripts as just another tool the agent can read. One agent, one tool surface, one chat history — voice becomes an input modality, not a separate product.

Status: **proposed**.

## Goal

Today we have two agents:

1. **Org canvas chat** (`src/app/org/[githubLogin]/page.tsx`) — Anthropic via Vercel AI SDK, streamed through `/api/ask/quick`, with rich tools for the canvas, connections, and initiatives (`src/lib/ai/canvasTools.ts`, `connectionTools.ts`, `initiativeTools.ts`). Single-player. Text only.
2. **LiveKit voice agent** (external Python service per `docs/plans/voice-agent.md`) — joins a LiveKit room, runs Deepgram for STT, calls back into Hive over MCP (`src/app/mcp/route.ts`, `src/lib/mcp/handler.ts`). Multi-participant. Voice only. Disconnected from whatever page the user is on.

Two agents means two system prompts, two tool surfaces, two chat histories, and two notions of "what is the user looking at." That split is the actual problem — not the infrastructure.

The fix is to delete the second agent. Keep LiveKit for what it's good at (rooms, audio, multi-participant transcription, presence), but stop running an LLM loop there. Transcripts already arrive in the browser via `RoomEvent.TranscriptionReceived` (`src/stores/useVoiceStore.ts:72-105`); the org chat agent can just *read them* through a new tool. Voice stops being a feature and becomes an input.

The longer-term play this unlocks: the org canvas page becomes the natural "meeting scratchpad" — everyone in a room is looking at the same canvas, the agent listens to the conversation and proposes initiatives/features/canvas edits in real time, and screen-sharing becomes obsolete because the page itself is the shared surface.

## Non-goals

- **Agent voice / TTS.** The agent replies in the chat sidebar, not into the room. If we ever want the agent to literally speak, that's when we revisit running an external relay (see "Future" below). Not now.
- **Multi-player canvas.** Cursors, presence, concurrent editing on the org canvas are a separate workstream. Voice doesn't require it; it just makes it more obviously valuable later.
- **Replacing the `/w/[slug]/calls` page wholesale.** That page can stay as a generic "join a room" surface. The new behavior is additive: when you're on an org canvas page *and* in a LiveKit room, the chat agent gets ears.
- **Killing the `/mcp` server.** MCP stays as an external integration surface. We're just removing the in-house Python agent as its primary consumer.
- **Server-authoritative transcripts in the first cut.** Phase 1 reads from the browser buffer. Server persistence is a phase 2 concern (see below).
- **Proactive agent interjection.** The agent only responds when a user sends a message. A periodic "anything worth acting on?" timer is a tempting hack but stays out of scope.

## The shape

```
┌─────────────────────────────────────────────────────────────────────┐
│ Org Canvas Page                                                     │
│                                                                     │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐   │
│  │                          │    │ Chat | Details | Connections │   │
│  │     system-canvas        │    ├──────────────────────────────┤   │
│  │                          │    │  [user text or voice icon]   │   │
│  │                          │    │  agent: ...                  │   │
│  │                          │    │                              │   │
│  │                          │    │  ┌────────────────────────┐  │   │
│  │                          │    │  │ 🎙 Voice connected      │  │   │
│  │                          │    │  │ Alice, Bob in room      │  │   │
│  │                          │    │  └────────────────────────┘  │   │
│  └──────────────────────────┘    └──────────────────────────────┘   │
│                                                                     │
│              LiveKit room (audio + transcripts only)                │
└─────────────────────────────────────────────────────────────────────┘
```

The LiveKit `useVoiceStore` already exists app-wide. On the org canvas page we just (a) surface a "connect voice" affordance in the chat sidebar, (b) buffer incoming transcripts with speaker attribution, and (c) expose them to the agent.

## Phase 1 — read_transcript

The minimum viable change. No new infra, no relay server, no DB writes.

1. **Buffer transcripts.** `useVoiceStore` already receives `RoomEvent.TranscriptionReceived`. Keep a rolling buffer of `{ participantIdentity, text, timestamp, isFinal }` entries. Cap it at something reasonable (last hour? last 1000 entries?).
2. **Expose `read_transcript` as a tool.** New `src/lib/ai/voiceTools.ts`, merged into `/api/ask/quick` next to the canvas/connection/initiative tools (`src/app/api/ask/quick/route.ts:310-326`). Signature roughly `read_transcript({ minutes?: number, speaker?: string })` → returns formatted `[Alice 14:03] ...` lines.
3. **Pass the buffer in.** Since the buffer lives in the browser and the tool runs server-side, the simplest path is: the client includes the recent transcript in the request body when sending a chat message, and the tool reads from that. (Yes, this means the tool's "input" is partially side-channeled. It's fine for phase 1.) Alternative: client uploads the buffer on connect and on a debounce, server reads from cache. We'll pick during implementation.
4. **Surface room state in the chat sidebar.** A small "🎙 connected — Alice, Bob" pill at the top of `SidebarChat` when `useVoiceStore.connected` is true, with a connect/disconnect button. Reuses everything in `useVoiceStore` already.

That's the whole feature. The agent can now answer "what did we just decide?", "summarize the last 10 minutes," or "create an initiative for what Alice was just describing" — using the same `propose_initiative` / `patch_canvas` / `save_connection` tools it already has.

## Phase 2 — server-side transcripts

Phase 1 breaks for late-joiners (their browser buffer is short) and for any cross-session use ("summarize yesterday's call"). Fix by also POSTing transcripts to Hive as they arrive.

- New `POST /api/org/[githubLogin]/transcripts` endpoint, debounced from `useVoiceStore`. Cheap — transcripts are tiny.
- New `Transcript` Prisma model: `{ orgId, roomId, participantIdentity, text, isFinal, createdAt }`. Indexed on `(orgId, roomId, createdAt)`.
- `read_transcript` switches to reading from DB. Browser buffer becomes a fallback / nice-to-have.
- Unlocks: post-call summaries, "what did we discuss about X last week," speaker-attributed messages threaded into chat history, action-item extraction across sessions.

## Phase 3 — retire the external agent

Once phase 1 is in place and we're confident the org-chat agent covers the use cases the voice agent does today, delete the Python agent. LiveKit stays. The `/mcp` endpoint stays (other external integrations may use it). The `/w/[slug]/calls` page stays as a generic room-join surface or gets folded into a "voice" affordance on every relevant page.

## What this is *not* a substitute for

If we ever genuinely need the agent to **speak into the room** (synthetic voice as a participant), phase 1/2 don't deliver that — the agent only writes to the chat sidebar. That's the point at which we'd build a thin "voice I/O relay" external service: dumb microphone+speaker that forwards transcripts into Hive and TTSes Hive's responses back into the room. All intelligence still lives in Hive.

Today's bet: the agent showing its work on the shared canvas everyone is already looking at is a better UX than the agent talking. If that bet turns out wrong, the relay is a small additive change — not a rewrite.

## Open questions

- **Transcript transport for phase 1:** include in request body vs. push-on-debounce vs. server reads from a cache keyed by `roomId`. Tradeoff is mostly latency vs. token bloat on every message.
- **Buffer cap:** how many minutes of context is enough before we *need* phase 2? Probably "one meeting."
- **Privacy / consent:** transcripts contain everyone in the room. Storing them server-side (phase 2) needs an obvious indicator and probably a per-org toggle.
- **Speaker identity mapping:** LiveKit `participantIdentity` → Hive `User`. Token route already knows the Hive user when minting (`src/app/api/livekit-token/route.ts`); we should embed `userId` in the participant identity so the agent can refer to people by name.
- **Concurrent agents in one room:** if Alice and Bob are both on the org canvas page in the same LiveKit room and both ask the agent something, do they each get their own answer in their own sidebar, or does the agent reply to one shared chat? Phase 1 ships per-user (matches today's single-player chat). Shared chat is a multi-player canvas concern.
