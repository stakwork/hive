/**
 * A LiveKit ticket Hive mints for a paired device joining a Hive call
 * (`/api/strut-devices/calls/ticket`), in place of the one meet's
 * `/api/connection-details` hands anyone. What makes it worth minting is
 * the identity: Hive picks it and records it against the device's person
 * (`storeCallMember`), so a turn voice names it on runs as them
 * (`docs/plans/call-speaker-identity.md`).
 *
 * No one else can join under it. Meet's identities are always
 * `<name>__<4 characters>`, so a name typed into meet never produces one
 * with no `__`, and Hive mints `hive_<32 hex>` only for the device it
 * records. Everything else is meet's token as it is: the same grants (never
 * room admin), the same 5 minutes, the name and metadata the device sent.
 */

import { randomBytes } from "crypto";
import { AccessToken } from "livekit-server-sdk";

/** The identities Hive mints. Never contains `__`, which every identity meet mints does. */
export const CALL_TICKET_IDENTITY_RE = /^hive_[0-9a-f]{32}$/;

const TICKET_TTL = "5m";

export interface CallTicket {
  /** The public media server, the one meet answers with: what a client connects to. */
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
  identity: string;
}

/** LiveKit is not configured for minting (the public URL, the key or the secret is unset). */
export class CallTicketUnconfiguredError extends Error {}

/** A new identity for a ticket. */
export function newCallTicketIdentity(): string {
  return `hive_${randomBytes(16).toString("hex")}`;
}

/**
 * A ticket for `roomName` as `participantName`, with `metadata` passed on
 * as meet passes it. `LIVEKIT_PUBLIC_URL` is the address clients connect to
 * (meet's `LIVEKIT_URL`); the dispatch's `LIVEKIT_URL` may be another
 * address of the same project.
 */
export async function mintCallTicket(args: {
  roomName: string;
  participantName: string;
  metadata?: string;
}): Promise<CallTicket> {
  const serverUrl = process.env.LIVEKIT_PUBLIC_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) {
    throw new CallTicketUnconfiguredError("LiveKit is not configured (LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)");
  }
  const identity = newCallTicketIdentity();
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: args.participantName,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ttl: TICKET_TTL,
  });
  token.addGrant({
    room: args.roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  return {
    serverUrl,
    roomName: args.roomName,
    participantToken: await token.toJwt(),
    participantName: args.participantName,
    identity,
  };
}
