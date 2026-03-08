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

export interface AddContactBody {
  contact_info: string;
  alias?: string;
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

function getBotBaseUrl(): string {
  const base = optionalEnvVars.V2_BOT_URL;
  if (!base) return "";
  return base.replace(/\/+$/, "");
}

function getBotUrl(): string {
  const base = getBotBaseUrl();
  if (!base) return "";
  // In mock mode the full URL is already set; in production append /send
  if (base.includes("/api/mock/")) return base;
  return `${base}/send`;
}

function getBotToken(): string {
  return optionalEnvVars.V2_BOT_TOKEN;
}

interface ContactResponse {
  contact_key?: string | null;
  [key: string]: unknown;
}

/**
 * Fetch a contact from the bot's store.
 * Returns the parsed contact object if found, or null.
 */
async function getContact(pubkey: string): Promise<ContactResponse | null> {
  const base = getBotBaseUrl();
  const token = getBotToken();
  if (!base || !token) return null;

  try {
    const res = await fetch(`${base}/get_contact/${pubkey}`, {
      method: "GET",
      headers: { "x-admin-token": token },
    });
    if (!res.ok) return null;
    return (await res.json()) as ContactResponse;
  } catch {
    return null;
  }
}

/**
 * Add a contact to the bot's store so it can route messages.
 * contact_info format: "{pubkey}_{lsp_pubkey}_{scid}"
 */
async function addContact(contactInfo: string): Promise<void> {
  const base = getBotBaseUrl();
  const token = getBotToken();
  if (!base || !token) return;

  const body: AddContactBody = { contact_info: contactInfo };
  const res = await fetch(`${base}/add_contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`add_contact failed: ${res.status} - ${text}`);
  }
}

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

/**
 * Wait for the key exchange to complete by polling get_contact
 * until contact_key is populated (every 2s, up to 15 attempts = 30s).
 */
async function waitForKeyExchange(pubkey: string): Promise<boolean> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const contact = await getContact(pubkey);
    if (contact?.contact_key) {
      logger.info(`[SPHINX DM] Key exchange complete for ${pubkey.slice(0, 12)}… (attempt ${i + 1})`, "SPHINX_DM");
      return true;
    }
  }
  return false;
}

/**
 * Ensure a contact exists in the bot's store before sending.
 * If routeHint is provided, builds "{pubkey}_{routeHint}" as contact_info.
 * Skipped in mock mode (base URL contains "/api/mock/").
 *
 * If the contact is new, calls add_contact then polls get_contact every
 * 2 seconds (up to 30s) waiting for the key exchange to complete.
 */
async function ensureContact(dest: string, routeHint?: string): Promise<void> {
  if (!routeHint) return;
  const base = getBotBaseUrl();
  if (base.includes("/api/mock/")) return;

  const existing = await getContact(dest);
  if (existing?.contact_key) return;

  if (!existing) {
    const contactInfo = `${dest}_${routeHint}`;
    logger.info(`[SPHINX DM] Adding contact for ${dest.slice(0, 12)}…`, "SPHINX_DM");
    await addContact(contactInfo);
  }

  // Poll until key exchange completes (contact_key is set)
  const ready = await waitForKeyExchange(dest);
  if (!ready) {
    logger.warn(`[SPHINX DM] Key exchange did not complete within 30s for ${dest.slice(0, 12)}…`, "SPHINX_DM");
  }
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
 * If a routeHint is provided the function will first ensure the recipient
 * exists as a contact in the bot's store (get_contact → add_contact) before
 * calling /send.
 *
 * @param dest      - Recipient's Lightning public key (66-char hex)
 * @param content   - Message text
 * @param opts      - Optional overrides (amt_msat, wait, routeHint)
 */
export async function sendDirectMessage(
  dest: string,
  content: string,
  opts: Pick<SendMessageBody, "amt_msat" | "wait"> & { routeHint?: string } = {},
): Promise<SendDMResult> {
  const url = getBotUrl();
  const token = getBotToken();

  if (!url || !token) {
    const msg = "V2_BOT_URL or V2_BOT_TOKEN is not configured";
    logger.warn(`[SPHINX DM] ${msg}`, "SPHINX_DM");
    return { success: false, error: msg };
  }

  try {
    // Ensure recipient contact exists before sending
    await ensureContact(dest, opts.routeHint);

    const body: SendMessageBody = {
      dest,
      content,
      wait: opts.wait ?? false,
      ...(opts.amt_msat != null && { amt_msat: opts.amt_msat }),
    };

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
