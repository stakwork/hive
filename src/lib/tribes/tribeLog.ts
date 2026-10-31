/**
 * The log of a linked Sphinx tribe (`docs/plans/jamie-in-tribes.md`, "The
 * log"): what Jamie hands `/api/tribes/log`, a batch of what was said there,
 * and the file a batch goes to strut as. Pure: the route does the rest.
 */

import { SPHINX_PUBKEY_RE } from "@/lib/tribes/jamie";
import { tribeName } from "@/lib/tribes/tribeLinks";

const MAX_ID_CHARS = 200;
const MAX_ALIAS_CHARS = 200;
const MAX_TEXT_CHARS = 20_000;
/** The daemon sends 50 at most; this is the room for a wider one. */
const MAX_MESSAGES = 500;
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;
/** What the run's attachment is called, under attachments/ in its files. */
export const TRIBE_LOG_FILE = "tribe-messages.jsonl";

/** One message as it goes into the run's file. */
export interface LogLine {
  id: string;
  time: string;
  alias: string;
  owner: boolean;
  mine: boolean;
  text: string;
  replyTo?: string;
  thread?: string;
}

export interface Batch {
  batch: string;
  tribe: { pubkey: string; name: string | null };
  messages: LogLine[];
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** An id as members hold it, or null. */
const idOf = (raw: unknown): string | null =>
  typeof raw === "string" && raw.trim() && raw.trim().length <= MAX_ID_CHARS ? raw.trim() : null;

/** The body, or what is wrong with it. */
export function parseBatch(raw: unknown): Batch | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  const batch = idOf(b.batch);
  if (!batch) return "batch is required";
  const tribe = b.tribe as Record<string, unknown> | null | undefined;
  const pubkey = typeof tribe?.pubkey === "string" ? tribe.pubkey.trim().toLowerCase() : "";
  if (!SPHINX_PUBKEY_RE.test(pubkey)) return "tribe.pubkey must be a tribe's pubkey";
  if (!Array.isArray(b.messages) || b.messages.length === 0) return "messages must be a list of at least one";
  if (b.messages.length > MAX_MESSAGES) return `messages is over ${MAX_MESSAGES}`;

  const messages: LogLine[] = [];
  for (const [i, raw] of b.messages.entries()) {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || Array.isArray(m)) return `messages[${i}] must be an object`;
    const id = idOf(m.id);
    if (!id) return `messages[${i}].id is required`;
    if (!isIso(m.time)) return `messages[${i}].time must be an ISO date`;
    const text = typeof m.text === "string" ? m.text : "";
    if (!text.trim()) return `messages[${i}].text is required`;
    if (text.length > MAX_TEXT_CHARS) return `messages[${i}].text is over ${MAX_TEXT_CHARS} characters`;
    const alias = typeof m.alias === "string" ? m.alias.replace(/\s+/g, " ").trim().slice(0, MAX_ALIAS_CHARS) : "";
    const replyTo = idOf(m.replyTo);
    const thread = idOf(m.thread);
    messages.push({
      id,
      time: new Date(m.time).toISOString(),
      // A tribe tells members apart by alias, and may have none for one.
      alias: alias || "A member",
      owner: m.owner === true,
      mine: m.mine === true,
      text,
      ...(replyTo ? { replyTo } : {}),
      ...(thread ? { thread } : {}),
    });
  }
  return { batch, tribe: { pubkey, name: tribeName(tribe?.name) }, messages };
}

/** The batch as the run's file: one JSON object per message, in the order sent. */
export function batchFile(messages: LogLine[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

/** Who wrote, by alias, in order of their first message; never Jamie. */
export function batchAliases(messages: LogLine[]): string[] {
  const out: string[] = [];
  for (const m of messages) if (!m.mine && !out.includes(m.alias)) out.push(m.alias);
  return out;
}

/** The workflow a batch goes to, or null while the log is off. */
export function tribeMessagesWorkflowName(): string | null {
  return process.env.TRIBE_MESSAGES_STRUT_WORKFLOW_NAME?.trim() || null;
}
