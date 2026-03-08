import { logger } from "@/lib/logger";
import { optionalEnvVars } from "@/config/env";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SendMessageBody {
  dest: string;
  content?: string;
  amt_msat?: number;
  is_tribe?: boolean;
  reply_uuid?: string;
  msg_type?: number;
  wait?: boolean;
}

export interface SphinxDMResponse {
  type?: number;
  message?: string;
  sender?: string;
  uuid?: string;
  error?: string;
}

export interface SendDMResult {
  success: boolean;
  response?: SphinxDMResponse;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBotUrl(): string {
  const base = optionalEnvVars.V2_BOT_URL;
  if (!base) return "";
  // In mock mode the full URL is already set; in production append /send
  if (base.includes("/api/mock/")) return base;
  return `${base.replace(/\/+$/, "")}/send`;
}

function getBotToken(): string {
  return optionalEnvVars.V2_BOT_TOKEN;
}

/**
 * Returns true when both V2_BOT_URL and V2_BOT_TOKEN are configured.
 */
export function isDirectMessageConfigured(): boolean {
  return !!(getBotUrl() && getBotToken());
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Send a direct message to a Sphinx user via Lightning pubkey.
 *
 * This uses the V2 Bot `/send` endpoint — a separate server from the
 * tribe broadcast endpoint at `/api/action`.
 *
 * @param dest    - Recipient's Lightning public key
 * @param content - Message text
 * @param opts    - Optional overrides (amt_msat, wait, etc.)
 */
export async function sendDirectMessage(
  dest: string,
  content: string,
  opts: Pick<SendMessageBody, "amt_msat" | "wait"> = {},
): Promise<SendDMResult> {
  const url = getBotUrl();
  const token = getBotToken();

  if (!url || !token) {
    const msg = "V2_BOT_URL or V2_BOT_TOKEN is not configured";
    logger.warn(`[SPHINX DM] ${msg}`, "SPHINX_DM");
    return { success: false, error: msg };
  }

  const body: SendMessageBody = {
    dest,
    content,
    wait: opts.wait ?? false,
    ...(opts.amt_msat != null && { amt_msat: opts.amt_msat }),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sphinx Bot API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as SphinxDMResponse;

    if (result.error) {
      throw new Error(result.error);
    }

    return { success: true, response: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[SPHINX DM] Failed to send direct message", "SPHINX_DM", {
      dest,
      error: message,
    });
    return { success: false, error: message };
  }
}

/**
 * Send a direct message to a Sphinx tribe/group.
 *
 * Same transport as `sendDirectMessage` but sets `is_tribe: true` so the
 * V2 Bot routes the message to a group chat rather than a 1:1 conversation.
 */
export async function sendTribeMessage(
  tribePubkey: string,
  content: string,
  opts: Pick<SendMessageBody, "amt_msat" | "wait"> = {},
): Promise<SendDMResult> {
  const url = getBotUrl();
  const token = getBotToken();

  if (!url || !token) {
    const msg = "V2_BOT_URL or V2_BOT_TOKEN is not configured";
    logger.warn(`[SPHINX DM] ${msg}`, "SPHINX_DM");
    return { success: false, error: msg };
  }

  const body: SendMessageBody = {
    dest: tribePubkey,
    content,
    is_tribe: true,
    wait: opts.wait ?? false,
    ...(opts.amt_msat != null && { amt_msat: opts.amt_msat }),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sphinx Bot API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as SphinxDMResponse;

    if (result.error) {
      throw new Error(result.error);
    }

    return { success: true, response: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[SPHINX DM] Failed to send tribe message", "SPHINX_DM", {
      dest: tribePubkey,
      error: message,
    });
    return { success: false, error: message };
  }
}
