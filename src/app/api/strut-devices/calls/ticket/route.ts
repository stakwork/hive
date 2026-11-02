import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { callKeyForRoom, callRecordTtl, peekCallRecord, storeCallMember } from "@/lib/calls/callRecord";
import { CallTicketUnconfiguredError, mintCallTicket } from "@/lib/calls/callTicket";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * POST /api/strut-devices/calls/ticket — a paired device's ticket to join a
 * Hive call (`docs/plans/call-speaker-identity.md`)
 *
 * In place of meet's `/api/connection-details`, for a room Hive made: the
 * same LiveKit token, under an identity Hive picks and records against the
 * device's person, so what they ask Jamie on the call runs as them. The
 * answer is meet's shape. A device that gets anything but a 200 joins
 * through meet as before, and its turns run as the call's starter.
 *
 * Authenticated by the device credential alone (a `webhook` route in the
 * middleware).
 *
 * Header: Authorization: Bearer hivedev_…
 * Body:   { room, participantName, metadata? }   metadata: a JSON object, as meet takes it
 * 200: { serverUrl, roomName, participantToken, participantName }
 * 400: a body that is not that
 * 401: unknown or revoked credential
 * 403: the device's person cannot use the call's workspace
 * 404: no live Hive call in that room
 * 503: LiveKit not configured for minting
 */

const MAX_ROOM_CHARS = 256;
const MAX_NAME_CHARS = 200;
const MAX_METADATA_BYTES = 4096;

interface TicketBody {
  room: string;
  participantName: string;
  metadata?: string;
}

/** The body, or what is wrong with it. */
function parseTicketBody(raw: unknown): TicketBody | string {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  const room = typeof b.room === "string" ? b.room.trim() : "";
  if (!room || room.length > MAX_ROOM_CHARS) return "room is required";
  // A name is shown on the call's tiles and before a request: one line.
  const participantName = typeof b.participantName === "string" ? b.participantName.replace(/\s+/g, " ").trim() : "";
  if (!participantName || participantName.length > MAX_NAME_CHARS) return "participantName is required";
  if (b.metadata === undefined || b.metadata === null || b.metadata === "") return { room, participantName };
  if (typeof b.metadata !== "string" || Buffer.byteLength(b.metadata, "utf8") > MAX_METADATA_BYTES) {
    return `metadata must be a string of at most ${MAX_METADATA_BYTES} bytes`;
  }
  try {
    const parsed: unknown = JSON.parse(b.metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "metadata must be a JSON object";
  } catch {
    return "metadata must be a JSON object";
  }
  return { room, participantName, metadata: b.metadata };
}

export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const device = await validateDeviceCredential(bearer);
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = parseTicketBody(await request.json().catch(() => null));
    if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });

    const callKey = await callKeyForRoom(body.room);
    const record = callKey ? await peekCallRecord(callKey) : null;
    if (!callKey || !record || callRecordTtl(record) <= 0) {
      return NextResponse.json({ error: "No Hive call in that room" }, { status: 404 });
    }

    // What every turn of theirs checks again (`/api/calls/turn`).
    const access = await validateWorkspaceAccess(record.workspaceSlug, device.userId);
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let ticket: Awaited<ReturnType<typeof mintCallTicket>>;
    try {
      ticket = await mintCallTicket({ roomName: body.room, participantName: body.participantName, metadata: body.metadata });
    } catch (err) {
      if (err instanceof CallTicketUnconfiguredError) {
        logger.error("Call ticket: LiveKit not configured", "STRUT_DEVICES");
        return NextResponse.json({ error: "LiveKit call service not configured" }, { status: 503 });
      }
      throw err;
    }
    await storeCallMember(callKey, record, ticket.identity, device.userId);

    const { serverUrl, roomName, participantToken, participantName } = ticket;
    return NextResponse.json({ serverUrl, roomName, participantToken, participantName });
  } catch (error) {
    logger.error("Strut device call ticket failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to make a call ticket" }, { status: 500 });
  }
}
