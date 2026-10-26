/**
 * Starting Jamie (the sphinx-voice LiveKit agent) in a room with the Hive
 * credential it acts with — without that credential ever reaching a
 * browser.
 *
 * Every participant in a LiveKit room can read every other participant's
 * metadata, and a call URL is pasted to whoever is invited, so neither
 * may carry a credential. Instead:
 *
 *   1. The minted Hive token is stored in Redis behind an opaque callKey
 *      (`storeCallToken`).
 *   2. Jamie is dispatched EXPLICITLY into the room with the callKey in
 *      the dispatch metadata (`dispatchCallAgent`), which LiveKit hands to
 *      the agent's job — not to the room.
 *   3. Jamie trades the callKey for the token at
 *      `POST /api/calls/exchange-token`, presenting its own key
 *      (`VOICE_AGENT_API_KEY`). A callKey on its own is worth nothing, so
 *      a dispatch listing read with a room-admin token leaks nothing usable.
 *
 * The agent must be registered with the same agent name
 * (`LIVEKIT_AGENT_NAME`, default "jamie"); with an agent name set, LiveKit
 * no longer auto-dispatches it into every room.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import { AgentDispatchClient } from "livekit-server-sdk";
import { redis } from "@/lib/redis";

/** How long a callKey can be exchanged: the length of a long call, with margin. */
export const CALL_TOKEN_TTL_SECONDS = 7200;

const CALL_TOKEN_PREFIX = "call-token:";

/** The name sphinx-voice registers with; dev and prod may use different ones. */
export function callAgentName(): string {
  return process.env.LIVEKIT_AGENT_NAME || "jamie";
}

/** Store `hiveToken` behind a fresh opaque callKey and return the key. */
export async function storeCallToken(hiveToken: string): Promise<string> {
  const callKey = randomBytes(12).toString("hex"); // 24-char hex
  await redis.set(CALL_TOKEN_PREFIX + callKey, hiveToken, "EX", CALL_TOKEN_TTL_SECONDS);
  return callKey;
}

/** The token a callKey stands for, or null when it is unknown or expired. */
export async function readCallToken(callKey: string): Promise<string | null> {
  return redis.get(CALL_TOKEN_PREFIX + callKey);
}

/** Forget a callKey (a dispatch that failed leaves nothing exchangeable behind). */
export async function dropCallToken(callKey: string): Promise<void> {
  await redis.del(CALL_TOKEN_PREFIX + callKey);
}

/**
 * The LiveKit room a call link opens: meet serves `/rooms/<room>` and joins
 * the room its last path segment names. `LIVEKIT_CALL_BASE_URL` ends with a
 * room prefix (`…/rooms/sphinx.call.-`), so the room is read off the
 * finished link, never the part a route appends to the base.
 */
export function callRoomName(callUrl: string): string {
  return decodeURIComponent(new URL(callUrl).pathname.split("/").pop() ?? "");
}

/**
 * Dispatch Jamie into `roomName` with the callKey in the dispatch
 * metadata. LiveKit creates the room if it does not exist yet. Throws when
 * LiveKit is not configured or refuses the dispatch.
 */
export async function dispatchCallAgent(roomName: string, callKey: string): Promise<void> {
  if (!roomName) throw new Error("No room to dispatch Jamie into");
  // The server-side URL of the LiveKit project the calls run on — the one
  // sphinx-voice registers with. The SDK turns a ws(s) URL into http(s).
  const host = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!host || !apiKey || !apiSecret) {
    throw new Error("LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)");
  }
  const client = new AgentDispatchClient(host, apiKey, apiSecret);
  await client.createDispatch(roomName, callAgentName(), {
    metadata: JSON.stringify({ callKey }),
  });
}

/**
 * Whether `request` carries the voice agent's key
 * (`Authorization: Bearer <VOICE_AGENT_API_KEY>`), compared in constant
 * time. False when the key is not configured: the exchange fails closed.
 */
export function carriesVoiceAgentKey(authorization: string | null): boolean {
  const expected = process.env.VOICE_AGENT_API_KEY;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const a = Buffer.from(authorization.slice("Bearer ".length));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
