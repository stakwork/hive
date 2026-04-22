import crypto from "crypto";

/**
 * Signed-state utilities for the GitHub App install → callback handshake.
 *
 * The callback at `/api/github/app/callback` trusts the `workspaceSlug`
 * encoded into the `state` query parameter to decide which workspace to
 * rewire to a `SourceControlOrg`. Historically `state` was just base64-
 * encoded JSON — any attacker who knew a victim workspace slug could
 * forge a `state`, walk through the OAuth flow, and hijack the victim
 * workspace's `sourceControlOrgId` (or unlink it via `setup_action=uninstall`),
 * routing all subsequent webhook / PR traffic through an attacker-
 * controlled installation.
 *
 * We now sign the state payload with `NEXTAUTH_SECRET` using HMAC-SHA256
 * so forging it requires server-side key compromise. `verifyState` is
 * constant-time and treats malformed / expired / unsigned values as
 * invalid rather than falling back to the legacy unsigned path.
 *
 * Format: `<base64url(json)>.<hex(hmac-sha256)>`
 */

export interface GithubAppStatePayload {
  workspaceSlug: string;
  repositoryUrl?: string;
  randomState: string;
  timestamp: number;
}

const MAX_STATE_AGE_MS = 60 * 60 * 1000; // 1 hour — matches the callback's pre-existing timestamp check

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required for GitHub App state signing",
    );
  }
  return secret;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

export function signGithubAppState(payload: GithubAppStatePayload): string {
  const json = JSON.stringify(payload);
  const body = base64url(Buffer.from(json, "utf-8"));
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("hex");
  return `${body}.${signature}`;
}

export interface VerifyResult {
  ok: boolean;
  reason?:
    | "malformed"
    | "bad_signature"
    | "invalid_json"
    | "expired"
    | "invalid_payload";
  payload?: GithubAppStatePayload;
}

export function verifyGithubAppState(state: string | null | undefined): VerifyResult {
  if (!state || typeof state !== "string") {
    return { ok: false, reason: "malformed" };
  }

  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const [body, signature] = parts;
  if (!body || !signature) return { ok: false, reason: "malformed" };

  let expectedSignature: string;
  try {
    expectedSignature = crypto
      .createHmac("sha256", getSecret())
      .update(body)
      .digest("hex");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  // Constant-time compare. Lengths differ → immediately invalid.
  if (signature.length !== expectedSignature.length) {
    return { ok: false, reason: "bad_signature" };
  }
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expectedSignature, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: GithubAppStatePayload;
  try {
    payload = JSON.parse(fromBase64url(body).toString("utf-8"));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (
    !payload ||
    typeof payload.workspaceSlug !== "string" ||
    typeof payload.randomState !== "string" ||
    typeof payload.timestamp !== "number"
  ) {
    return { ok: false, reason: "invalid_payload" };
  }

  const age = Date.now() - payload.timestamp;
  if (age > MAX_STATE_AGE_MS || age < 0) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
