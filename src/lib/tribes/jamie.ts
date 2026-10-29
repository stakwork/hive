/**
 * Jamie in Sphinx tribes (`docs/plans/jamie-in-tribes.md`): the Sphinx
 * account that sits in linked tribes (stakwork/sphinx `wasm/daemon`) and
 * the configuration Hive knows it by.
 *
 *   - `JAMIE_SERVICE_TOKEN`: what the account sends on every call to
 *     `/api/tribes/*` (the daemon's `DAEMON_SERVICE_TOKEN`). Unset: the
 *     feature is off — every tribe route answers 503.
 *   - `JAMIE_SPHINX_PUBKEY`: the account's pubkey, which the daemon prints
 *     when it starts (its `address` begins with it). A link answers it, so
 *     the owner's Peel can approve Jamie's member request in a private tribe.
 *   - `JAMIE_SPHINX_ALIAS`: its alias, "Jamie" by default.
 *
 * Read per request, like `VOICE_AGENT_API_KEY`, so a deploy that sets them
 * needs no restart of anything but Hive.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export interface JamieAccount {
  pubkey: string;
  alias: string;
}

/** A Sphinx pubkey as the daemon reads one: 33 bytes, lower-case hex. */
export const SPHINX_PUBKEY_RE = /^[0-9a-f]{66}$/;

/** Jamie's account, or null when the feature is off or its pubkey is not set. */
export function jamieAccount(): JamieAccount | null {
  if (!process.env.JAMIE_SERVICE_TOKEN) return null;
  // The daemon prints an address, `<pubkey>_<route hint>`; the pubkey is its first part.
  const pubkey = (process.env.JAMIE_SPHINX_PUBKEY ?? "").trim().split("_")[0].toLowerCase();
  if (!SPHINX_PUBKEY_RE.test(pubkey)) return null;
  return { pubkey, alias: process.env.JAMIE_SPHINX_ALIAS?.trim() || "Jamie" };
}

function carriesJamieToken(authorization: string | null): boolean {
  const expected = process.env.JAMIE_SERVICE_TOKEN;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const a = Buffer.from(authorization.slice("Bearer ".length));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The gate of the routes Jamie calls (`/api/tribes/messages`, `outbox`,
 * `outbox/ack`): its token, `Authorization: Bearer <JAMIE_SERVICE_TOKEN>`.
 * Null when the request may go on.
 */
export function authorizeJamieRequest(request: NextRequest, tag: string): NextResponse | null {
  if (!process.env.JAMIE_SERVICE_TOKEN) {
    console.error(`[${tag}] JAMIE_SERVICE_TOKEN is not configured`);
    return NextResponse.json({ error: "Jamie in tribes is not configured" }, { status: 503 });
  }
  if (!carriesJamieToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
