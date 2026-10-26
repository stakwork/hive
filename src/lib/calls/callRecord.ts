/**
 * The call record: what a callKey stands for when Jamie on a call
 * (sphinx-voice) talks to strut's orchestrator through Hive
 * (`/api/calls/turn`, `/api/calls/messages`, `/api/calls/cancel`).
 *
 * Written beside the call token (`callAgent.ts`), under the same callKey,
 * by the two routes that start a call. It names who the call acts as (the
 * person who started it — anyone on the call speaks as them), the org and
 * workspace its turns run in, and the ONE Hive conversation the call's
 * turns go to, set by the first turn. Voice never sees any of it: it holds
 * the callKey and its own agent key, and each endpoint acts on this call's
 * conversation and nothing else.
 *
 * Lives 4 h, refreshed by every request from voice, and never past 12 h
 * after the call started — a callKey that leaked is worth nothing after
 * that, however busy the call.
 */

import { redis } from "@/lib/redis";

export interface CallRecord {
  /** Who started the call; every turn runs as them. */
  userId: string;
  /** The workspace's `sourceControlOrgId`; null for a workspace with no org, where Jamie cannot take a turn. */
  orgId: string | null;
  workspaceSlug: string;
  roomName: string;
  /** The call's conversation, set by its first turn. */
  conversationId: string | null;
  /** ISO. */
  createdAt: string;
}

/** How long a call record lives without a request from voice. */
export const CALL_RECORD_TTL_SECONDS = 4 * 3600;
/** How long after the call started a record may live at all. */
export const CALL_RECORD_MAX_AGE_SECONDS = 12 * 3600;

const CALL_RECORD_PREFIX = "call:";

const key = (callKey: string) => CALL_RECORD_PREFIX + callKey;

/** Seconds the record may still live: 4 h, cut to what is left of the 12. */
export function callRecordTtl(record: Pick<CallRecord, "createdAt">, now = Date.now()): number {
  const left = Math.floor((Date.parse(record.createdAt) + CALL_RECORD_MAX_AGE_SECONDS * 1000 - now) / 1000);
  return Math.min(CALL_RECORD_TTL_SECONDS, Number.isFinite(left) ? left : 0);
}

/** Write a new call's record (no conversation yet). */
export async function storeCallRecord(
  callKey: string,
  call: Pick<CallRecord, "userId" | "orgId" | "workspaceSlug" | "roomName">,
): Promise<void> {
  const record: CallRecord = { ...call, conversationId: null, createdAt: new Date().toISOString() };
  await redis.set(key(callKey), JSON.stringify(record), "EX", CALL_RECORD_TTL_SECONDS);
}

/** The record as stored, or null when it is unknown, expired or not one. Refreshes nothing. */
export async function peekCallRecord(callKey: string): Promise<CallRecord | null> {
  const raw = await redis.get(key(callKey));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as CallRecord;
    return typeof record?.userId === "string" && typeof record.createdAt === "string" ? record : null;
  } catch {
    return null;
  }
}

/**
 * The record for a request from voice, its lifetime refreshed; null when
 * the call is unknown or past its 12 hours (then dropped).
 */
export async function loadCallRecord(callKey: string): Promise<CallRecord | null> {
  const record = await peekCallRecord(callKey);
  if (!record) return null;
  const ttl = callRecordTtl(record);
  if (ttl <= 0) {
    await redis.del(key(callKey));
    return null;
  }
  await redis.expire(key(callKey), ttl);
  return record;
}

/** Record the call's conversation (its first turn created it). */
export async function setCallConversation(
  callKey: string,
  record: CallRecord,
  conversationId: string,
): Promise<CallRecord> {
  const next = { ...record, conversationId };
  await redis.set(key(callKey), JSON.stringify(next), "EX", Math.max(1, callRecordTtl(next)));
  return next;
}

/** Forget a call (a dispatch that failed leaves nothing behind). */
export async function dropCallRecord(callKey: string): Promise<void> {
  await redis.del(key(callKey));
}
