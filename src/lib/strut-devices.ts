import * as crypto from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";

/**
 * Strut device pairing — hive's half of strut `plans/chained-orchestrators.md`
 * §4. A person's laptop runs a strut whose peers are their orgs' central
 * struts; nothing can push to a laptop, so it PULLS person-scoped tokens,
 * and this is how it gets the right to.
 *
 * The OAuth device flow (RFC 8628): the desktop app starts a pairing and gets
 * a device code (its secret) and a short user code; the person opens
 * `/pair?code=…` signed in and approves; the desktop's poll with the device
 * code then receives, once, the device's own long-lived credential
 * (`hivedev_…`, only its SHA-256 hash is stored) plus the peer records
 * (`services/strut-device-peers.ts`). The credential renews those records
 * through `GET /api/strut-devices/peers`; revoking the device stops that, and
 * the 7-day peer tokens it holds age out.
 */

/** How long a pairing code lives before the person must approve it and the device collect it. */
export const PAIRING_TTL_SECONDS = 600;
/** How often the device should poll (RFC 8628 `interval`). */
export const PAIRING_POLL_INTERVAL_SECONDS = 5;
export const DEVICE_CREDENTIAL_PREFIX = "hivedev_";
const CREDENTIAL_DISPLAY_LENGTH = 12; // "hivedev_" + 4 chars
const DEVICE_NAME_MAX = 100;
const DEFAULT_DEVICE_NAME = "Desktop";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** RFC 8628 §6.1: consonants only, so no word is ever spelled and nothing reads as 0/O or 1/I. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

/** `XXXX-XXXX` from the user-code alphabet. */
export function generateUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** A code as a person typed it — any case, any separator — in its stored form, or null when it cannot be one. */
export function normalizeUserCode(input: string | null | undefined): string | null {
  const letters = (input ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length !== USER_CODE_LENGTH) return null;
  if (![...letters].every((c) => USER_CODE_ALPHABET.includes(c))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateDeviceCredential(): string {
  let encoded = "";
  for (const byte of crypto.randomBytes(32)) encoded += BASE62[byte % 62];
  return `${DEVICE_CREDENTIAL_PREFIX}${encoded}`;
}

export function isDeviceCredential(value: string | null | undefined): value is string {
  return !!value && value.startsWith(DEVICE_CREDENTIAL_PREFIX);
}

function deviceName(name: unknown): string {
  return typeof name === "string" && name.trim() ? name.trim().slice(0, DEVICE_NAME_MAX) : DEFAULT_DEVICE_NAME;
}

// ─── The flow ────────────────────────────────────────────────────────────

export interface StartedPairing {
  deviceCode: string;
  userCode: string;
  expiresAt: Date;
}

/**
 * A new pairing. Expired ones are deleted first: their codes are dead, and a
 * user code is unique among the rows, so this frees them.
 */
export async function startPairing(name: unknown, now: Date = new Date()): Promise<StartedPairing> {
  await db.strutDevicePairing.deleteMany({ where: { expiresAt: { lt: now } } });
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_SECONDS * 1000);
  for (let attempt = 0; ; attempt++) {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    try {
      await db.strutDevicePairing.create({
        data: { deviceCodeHash: hashApiKey(deviceCode), userCode, deviceName: deviceName(name), expiresAt },
      });
      return { deviceCode, userCode, expiresAt };
    } catch (err) {
      // A user code another live pairing holds: draw again.
      if (attempt < 4 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
}

export type PairingStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

export interface PairingView {
  userCode: string;
  deviceName: string;
  createdAt: Date;
  expiresAt: Date;
  status: PairingStatus;
  /** Whether the signed-in person is the one who approved or denied it. */
  decidedByYou: boolean;
}

function statusOf(
  row: { approvedAt: Date | null; deniedAt: Date | null; consumedAt: Date | null; expiresAt: Date },
  now: Date,
): PairingStatus {
  if (row.consumedAt) return "consumed";
  if (row.deniedAt) return "denied";
  if (row.expiresAt <= now) return "expired";
  return row.approvedAt ? "approved" : "pending";
}

/** The pairing a person is asked to approve, by the code they typed or followed. */
export async function findPairing(code: string, userId: string, now: Date = new Date()): Promise<PairingView | null> {
  const userCode = normalizeUserCode(code);
  if (!userCode) return null;
  const row = await db.strutDevicePairing.findUnique({ where: { userCode } });
  if (!row) return null;
  return {
    userCode: row.userCode,
    deviceName: row.deviceName,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: statusOf(row, now),
    decidedByYou: row.userId === userId,
  };
}

export type DecideResult =
  | { ok: true; status: "approved" | "denied" }
  | { ok: false; error: "not_found" | "expired" | "already_decided" };

/** Approve or deny a pending pairing, as the signed-in person. First decision wins. */
export async function decidePairing(params: {
  code: string;
  userId: string;
  approve: boolean;
  now?: Date;
}): Promise<DecideResult> {
  const now = params.now ?? new Date();
  const userCode = normalizeUserCode(params.code);
  if (!userCode) return { ok: false, error: "not_found" };
  const { count } = await db.strutDevicePairing.updateMany({
    where: { userCode, approvedAt: null, deniedAt: null, expiresAt: { gt: now } },
    data: { userId: params.userId, ...(params.approve ? { approvedAt: now } : { deniedAt: now }) },
  });
  if (count === 1) return { ok: true, status: params.approve ? "approved" : "denied" };
  const row = await db.strutDevicePairing.findUnique({ where: { userCode } });
  if (!row) return { ok: false, error: "not_found" };
  if (!row.approvedAt && !row.deniedAt) return { ok: false, error: "expired" };
  return { ok: false, error: "already_decided" };
}

export type PollResult =
  | { status: "authorization_pending" | "access_denied" | "expired_token" }
  | { status: "approved"; pairingId: string; userId: string; deviceName: string };

/**
 * The device's poll, read only: where its pairing stands. An unknown code
 * and one already collected are `expired_token` (RFC 8628 §3.5) — the device
 * starts over either way.
 */
export async function checkPairing(deviceCode: unknown, now: Date = new Date()): Promise<PollResult> {
  if (typeof deviceCode !== "string" || !deviceCode) return { status: "expired_token" };
  const row = await db.strutDevicePairing.findUnique({ where: { deviceCodeHash: hashApiKey(deviceCode) } });
  if (!row) return { status: "expired_token" };
  const status = statusOf(row, now);
  if (status === "pending") return { status: "authorization_pending" };
  if (status === "denied") return { status: "access_denied" };
  if (status !== "approved" || !row.userId) return { status: "expired_token" };
  return { status: "approved", pairingId: row.id, userId: row.userId, deviceName: row.deviceName };
}

/**
 * Collect an approved pairing: spend it and create the device, whose
 * credential is returned this once. Null when another poll collected it first.
 */
export async function consumePairing(
  pairing: { pairingId: string; userId: string; deviceName: string },
  now: Date = new Date(),
): Promise<{ device: { id: string; name: string }; credential: string } | null> {
  const credential = generateDeviceCredential();
  const device = await db.$transaction(async (tx) => {
    const { count } = await tx.strutDevicePairing.updateMany({
      where: { id: pairing.pairingId, consumedAt: null },
      data: { consumedAt: now },
    });
    if (count !== 1) return null;
    return tx.strutDevice.create({
      data: {
        userId: pairing.userId,
        name: pairing.deviceName,
        credentialPrefix: credential.slice(0, CREDENTIAL_DISPLAY_LENGTH),
        credentialHash: hashApiKey(credential),
      },
      select: { id: true, name: true },
    });
  });
  return device ? { device, credential } : null;
}

// ─── Devices ─────────────────────────────────────────────────────────────

/** The device a credential belongs to, or null when unknown, revoked, or its person is gone. */
export async function validateDeviceCredential(
  credential: string | null | undefined,
): Promise<{ deviceId: string; userId: string } | null> {
  if (!isDeviceCredential(credential)) return null;
  const device = await db.strutDevice.findUnique({
    where: { credentialHash: hashApiKey(credential) },
    select: { id: true, userId: true, revokedAt: true, user: { select: { deleted: true } } },
  });
  if (!device || device.revokedAt || device.user.deleted) return null;
  // Awaited: the settings card reads it back, and a renewal is one call a day.
  await db.strutDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return { deviceId: device.id, userId: device.userId };
}

/** The person's live devices, newest first. Never the credential. */
export async function listStrutDevices(userId: string) {
  return db.strutDevice.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, name: true, credentialPrefix: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Revoke one of the person's devices; false when it is not theirs or already revoked. The row stays for audit. */
export async function revokeStrutDevice(userId: string, deviceId: string): Promise<boolean> {
  const { count } = await db.strutDevice.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}
