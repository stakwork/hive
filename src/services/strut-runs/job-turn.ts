/**
 * Completion handler for `kind: "job_turn"` — one turn of the `job` strut
 * workflow behind `start_job` / `continue_job` (strut `plans/jobs.md`; the
 * tools are in `lib/ai/strutTools.ts`).
 *
 * The turn's run settled; this is where its reply reaches the Jamie chat.
 * The `job` workflow's agent answers in a fixed shape — its `pack` step is
 * the run's `output`:
 *
 *   { text, artifacts: [{ id, kind?, title, label?, summary?, path | url | content }], ask?: { message }, cost, session }
 *
 * and strut RESOLVES that `artifacts` list where a host receives it: the
 * `run.end` callback carries it as a top-level `artifacts`, and
 * `GET {lab}/workflows/job/runs/<runId>/artifacts` returns the same list
 * (`[{ id, kind, title, label?, summary?, url? | content? | error? }]` —
 * `url` strut-relative like `/jobs/<job>/files/plan.md`, `kind` inferred
 * from the extension when the agent gave none). The handler reads THAT
 * endpoint from the ROW's swarm rather than the callback body, so the
 * webhook and the reconcile path are one code path and the row needs no
 * `artifacts` column.
 *
 * It appends ONE assistant row to the row's conversation — `content` is a
 * header line the canvas agent reads the job id back from (`**Job · <id> ·
 * <title>**`, the strut-chat convention), the agent's `text`, and its
 * `ask` when it stopped for a decision — with `artifacts: ArtifactRef[]`
 * mapped from strut's list (`mapStrutArtifacts`, pure): a strut-relative
 * `url` becomes a `graph` source (`{ swarmId, key: <that url> }`) that the
 * reader route serves from the swarm; an absolute `url` and inline
 * `content` become `inline` sources; an entry strut could not resolve
 * (`error`) is dropped from the refs and named in the content. The
 * append has `canvas-strut-fanout.ts`'s discipline — `FOR UPDATE`,
 * ownership re-checked against hive's rows (never the payload), idempotent
 * by row id `job-<StrutRun.id>` — and never throws for a missing target.
 * `error` / `cancelled` / LOST rows append a row saying so.
 *
 * No canvas-agent wake in V1: the row IS the reply, and stored rows reach
 * the model as text on the next human message.
 *
 * Retry contract (`completeStrutRun`): a transient failure reading the
 * artifacts list throws, so the webhook answers 5xx and strut re-posts;
 * a 404 (the run is gone from strut) delivers the text without artifacts.
 */

import { z } from "zod";
import { StrutRunStatus } from "@prisma/client";
import type { ArtifactKind, ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { JOB_TURN_KIND, JOB_WORKFLOW, jobTitleOf, parseStrutArtifactKey } from "@/lib/strut-jobs";
import { labForRow, type StrutRunRow } from "@/services/strut-runs";

export { JOB_TURN_KIND, JOB_WORKFLOW, jobTitleOf };

const LOG_TAG = "JOB_TURN";
const READ_TIMEOUT_MS = 10_000;
/** Cap on the agent's reply text stored on the row. */
const MAX_TEXT_CHARS = 20_000;
/** Cap on an error message shown in the row. */
const MAX_ERROR_CHARS = 1_000;
/** Inline content larger than this is not stored on a message. */
const MAX_INLINE_CHARS = 50_000;
/** What `parseArtifactRefs` will keep — the rest is dropped here, not repaired later. */
const MAX_ID_CHARS = 200;
const MAX_TITLE_CHARS = 300;

/** The workflow's `output` (its `pack` step). Extra keys are tolerated. */
export const jobTurnOutputSchema = z
  .object({
    text: z.string().optional(),
    ask: z.object({ message: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** One entry of strut's RESOLVED list. */
export interface StrutArtifact {
  id: string;
  kind: string;
  title: string;
  label?: string;
  summary?: string;
  url?: string;
  content?: unknown;
  error?: string;
}

const KINDS: ReadonlySet<string> = new Set<ArtifactKind>([
  "markdown",
  "html",
  "image",
  "video",
  "audio",
  "pdf",
  "url",
  "diff",
  "pull_request",
  "code",
  "log",
  "json",
]);
/** Kinds whose content is an address, so an absolute `url` shows as given. */
const ADDRESS_KINDS: ReadonlySet<string> = new Set<ArtifactKind>(["image", "video", "audio", "pdf", "url"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/** Strut's list as it comes: every entry that is whole, in order. */
export function parseStrutArtifacts(raw: unknown): StrutArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: StrutArtifact[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id, MAX_ID_CHARS);
    const title = str(entry.title, MAX_TITLE_CHARS);
    if (!id || !title) continue;
    out.push({
      id,
      kind: typeof entry.kind === "string" ? entry.kind : "url",
      title,
      label: str(entry.label, 60),
      summary: str(entry.summary, 600),
      url: typeof entry.url === "string" ? entry.url : undefined,
      content: entry.content,
      error: typeof entry.error === "string" ? entry.error : undefined,
    });
  }
  return out;
}

const isAbsolute = (url: string): boolean => /^https?:\/\//i.test(url);
/** A strut-relative link: what the reader route accepts (`/jobs/<job>/files/…`, `/artifacts/<runId>/…`). */
const isStrutKey = (url: string): boolean => parseStrutArtifactKey(url) !== null;

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

/** The content an inline `content` value becomes, per kind — null when it is not something that kind can show. */
function inlineContent(kind: string, content: unknown): { kind: ArtifactKind; content: Record<string, unknown> } | null {
  if (isRecord(content)) {
    // Already the kind's shape (a pull request, a diff's files): the ref's
    // parser at hydration keeps it or drops it.
    return KINDS.has(kind) ? { kind: kind as ArtifactKind, content } : null;
  }
  if (typeof content !== "string") {
    return kind === "json" && content !== undefined ? { kind: "json", content: { value: content } } : null;
  }
  if (content.length > MAX_INLINE_CHARS) return null;
  // A pull request has no text form: a model whose output schema only
  // allowed a string sends the object as JSON text. Read it as the object.
  if (kind === "pull_request") {
    const parsed = parseJsonObject(content);
    return parsed ? inlineContent(kind, parsed) : null;
  }
  switch (kind) {
    case "markdown":
    case "log":
      return { kind, content: { text: content } };
    case "code":
      return { kind: "code", content: { code: content } };
    case "json": {
      try {
        return { kind: "json", content: { value: JSON.parse(content) } };
      } catch {
        return { kind: "json", content: { value: content } };
      }
    }
    // A unified diff as text: shown as code with diff highlighting (tom's
    // `diff` content is per-file `ActionResult`s, which a string is not).
    case "diff":
      return { kind: "code", content: { code: content, language: "diff" } };
    // A page's markup inline: hive's `html` content is a STORED page by
    // slug, so the markup is shown as code.
    case "html":
      return { kind: "code", content: { code: content, language: "html" } };
    case "url":
      return isAbsolute(content) ? { kind: "url", content: { url: content } } : null;
    default:
      return null;
  }
}

/** The file's name, for a `code` ref's highlighting. */
const basename = (key: string): string => key.split("?")[0].split("/").pop() ?? key;

/**
 * Strut's resolved entries → hive's refs. Pure. `dropped` names the entries
 * that became no ref — unresolved on strut's side, or a shape hive cannot
 * show — for the content to mention.
 */
export function mapStrutArtifacts(
  entries: StrutArtifact[],
  swarmId: string,
): { refs: ArtifactRef[]; dropped: Array<{ title: string; reason: string }> } {
  const refs: ArtifactRef[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];
  for (const entry of entries) {
    const base = { id: entry.id, title: entry.title, ...(entry.label ? { label: entry.label } : {}), ...(entry.summary ? { summary: entry.summary } : {}) };
    if (entry.error) {
      dropped.push({ title: entry.title, reason: entry.error });
      continue;
    }
    if (typeof entry.url === "string" && entry.url.length > 0) {
      if (isStrutKey(entry.url)) {
        // Served through the reader route from the swarm. A page strut
        // wrote is a static page there (the reader keeps strut's
        // `Content-Security-Policy: sandbox`), so it is shown as `url`; a
        // diff file or a pull request cannot be read off bytes, so as code.
        const kind: ArtifactKind = !KINDS.has(entry.kind)
          ? "url"
          : entry.kind === "html"
            ? "url"
            : entry.kind === "diff" || entry.kind === "pull_request"
              ? "code"
              : (entry.kind as ArtifactKind);
        refs.push({ ...base, kind, source: { type: "graph", swarmId, key: entry.url } });
        continue;
      }
      if (isAbsolute(entry.url)) {
        const kind: ArtifactKind = ADDRESS_KINDS.has(entry.kind) ? (entry.kind as ArtifactKind) : "url";
        refs.push({ ...base, kind, source: { type: "inline", content: { url: entry.url } } });
        continue;
      }
      dropped.push({ title: entry.title, reason: "bad url" });
      continue;
    }
    if (entry.content !== undefined) {
      const inline = inlineContent(entry.kind, entry.content);
      if (inline) {
        const content = inline.kind === "code" && !("filename" in inline.content) && entry.url ? { ...inline.content, filename: basename(entry.url) } : inline.content;
        refs.push({ ...base, kind: inline.kind, source: { type: "inline", content } });
      } else dropped.push({ title: entry.title, reason: "unsupported content" });
      continue;
    }
    dropped.push({ title: entry.title, reason: "nothing to show" });
  }
  return { refs, dropped };
}

// ─── The row ──────────────────────────────────────────────────────────────

/** How the turn ended, as the row's `source.status` says it. */
export type JobTurnOutcome = "success" | "error" | "cancelled" | "lost";

export interface JobTurnReply {
  outcome: JobTurnOutcome;
  /** The agent's reply, or what went wrong. */
  text: string;
  ask?: string;
  /** Strut's error message for a failed turn (already capped). */
  error?: string;
}

const cap = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** What a settled row says — pure, so every branch is testable. */
export function replyForRow(row: StrutRunRow): JobTurnReply {
  switch (row.status) {
    case StrutRunStatus.CANCELLED:
      return { outcome: "cancelled", text: "The turn was stopped." };
    case StrutRunStatus.LOST:
      return {
        outcome: "lost",
        text: "Strut lost track of this turn (it restarted before recording it). Send the message again.",
      };
    case StrutRunStatus.ERROR: {
      const error = cap(row.error || "The run failed.", MAX_ERROR_CHARS);
      const text = error.startsWith("job_busy:")
        ? "A previous turn of this job was still running, so this one could not start. Send the message again once it has finished."
        : `The turn did not complete: ${error}`;
      return { outcome: "error", text, error };
    }
    case StrutRunStatus.PENDING:
      // Not settled — nothing to say yet. (Never reached through completeStrutRun.)
      return { outcome: "error", text: "" };
    case StrutRunStatus.SUCCESS:
      break;
  }
  const parsed = jobTurnOutputSchema.safeParse(row.output);
  if (!parsed.success) {
    return { outcome: "error", text: "The turn ended, but its result was not in the shape a job turn answers in.", error: "unexpected output" };
  }
  const text = parsed.data.text?.trim() ? cap(parsed.data.text.trim(), MAX_TEXT_CHARS) : "_(no reply text)_";
  const ask = parsed.data.ask?.message?.trim() || undefined;
  return { outcome: "success", text, ...(ask ? { ask } : {}) };
}

/** Row id — also the idempotency key. */
export const jobRowId = (row: Pick<StrutRunRow, "id">): string => `job-${row.id}`;

export function renderJobContent(args: {
  jobId: string;
  title: string;
  reply: JobTurnReply;
  dropped: Array<{ title: string; reason: string }>;
}): string {
  const { jobId, title, reply, dropped } = args;
  const parts = [`**Job · ${jobId} · ${title}**`, reply.text];
  if (reply.ask) parts.push(`**Question for you:** ${reply.ask}`);
  if (dropped.length > 0) {
    parts.push(dropped.map((d) => `_Unavailable: ${d.title} (${d.reason})_`).join("\n"));
  }
  return parts.join("\n\n");
}

type JobMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  source: {
    kind: "job";
    jobId: string;
    strutRunId: string;
    workflow: string;
    status: JobTurnOutcome;
    title?: string;
    ask?: string;
  };
  artifacts?: ArtifactRef[];
};

// ─── Reading strut ────────────────────────────────────────────────────────

export type ArtifactsRead =
  | { ok: true; artifacts: StrutArtifact[] }
  /** The run is gone from strut (404): deliver without artifacts. */
  | { ok: false; permanent: true; reason: string }
  /** Transient (unreachable, 5xx): throw so strut re-posts. */
  | { ok: false; permanent: false; reason: string };

/** `GET {lab}/workflows/job/runs/<runId>/artifacts` on the ROW's swarm. Never throws. */
export async function readRunArtifacts(row: StrutRunRow): Promise<ArtifactsRead> {
  if (!row.strutRunId) return { ok: false, permanent: true, reason: "no strut run id" };
  const lab = await labForRow(row);
  if (!lab) return { ok: false, permanent: true, reason: "swarm credentials unavailable" };
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/artifacts`,
      { headers: { "x-api-token": lab.swarmApiKey }, cache: "no-store", signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    );
    if (res.status === 404) return { ok: false, permanent: true, reason: "run not found on strut" };
    if (!res.ok) return { ok: false, permanent: false, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { artifacts?: unknown };
    return { ok: true, artifacts: parseStrutArtifacts(body.artifacts) };
  } catch (err) {
    return { ok: false, permanent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────

export type JobFanOutResult = "appended" | "duplicate" | "skipped";

/**
 * Append the turn's row to the conversation. The target comes from the
 * ROW (`conversationId`, `userId`, the workspace's org) and is re-checked
 * against hive's own rows the way the dispatch admitted it
 * (`resolveOrgConversationRowId`: the workspace's org, owned by the user or
 * shared). Idempotent by row id. Throws only on a database failure.
 */
export async function appendJobRow(
  row: Pick<StrutRunRow, "id" | "workspaceId" | "userId" | "conversationId">,
  message: Omit<JobMessageRow, "id" | "role" | "timestamp">,
): Promise<JobFanOutResult> {
  const { conversationId } = row;
  if (!conversationId) return "skipped";
  const id = jobRowId(row);
  let result = "skipped" as JobFanOutResult;

  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: row.workspaceId }, select: { sourceControlOrgId: true } });
    const conversation = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, sourceControlOrgId: true, isShared: true },
    });
    if (!workspace?.sourceControlOrgId || !conversation) return;
    if (conversation.sourceControlOrgId !== workspace.sourceControlOrgId || (conversation.userId !== row.userId && !conversation.isShared)) {
      logger.warn("Job turn: conversation ownership mismatch — bail", LOG_TAG, { runId: row.id, conversationId });
      return;
    }

    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const existing = Array.isArray(locked[0].messages) ? (locked[0].messages as Array<{ id?: string }>) : [];
    if (existing.some((m) => m?.id === id)) {
      result = "duplicate";
      return;
    }

    const newRow: JobMessageRow = { id, role: "assistant", timestamp: new Date().toISOString(), ...message };
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { messages: [...existing, newRow] as unknown as never, lastMessageAt: new Date() },
    });
    result = "appended";
  });

  if (result === "appended") notifyCanvasConversationUpdated(conversationId, "job");
  return result;
}

/** The `StrutRunHandler` for `job_turn`. Throws to be retried. */
export async function handleJobTurnSettled(row: StrutRunRow): Promise<void> {
  const jobId = row.jobId;
  if (!jobId) {
    logger.error("Settled job turn has no job id", LOG_TAG, { runId: row.id });
    return;
  }
  const reply = replyForRow(row);
  if (row.status === StrutRunStatus.PENDING) return;

  let refs: ArtifactRef[] = [];
  let dropped: Array<{ title: string; reason: string }> = [];
  if (reply.outcome === "success") {
    const read = await readRunArtifacts(row);
    if (read.ok) {
      ({ refs, dropped } = mapStrutArtifacts(read.artifacts, row.swarmId));
    } else if (read.permanent) {
      logger.warn("Job turn artifacts unavailable — delivering the text alone", LOG_TAG, { runId: row.id, reason: read.reason });
      dropped = [{ title: "the turn's artifacts", reason: read.reason }];
    } else {
      // Strut re-posts the callback on a 5xx; the next attempt reads again.
      throw new Error(`job turn artifacts unavailable: ${read.reason}`);
    }
  }

  const title = jobTitleOf(row);
  const result = await appendJobRow(row, {
    content: renderJobContent({ jobId, title, reply, dropped }),
    source: {
      kind: "job",
      jobId,
      strutRunId: row.strutRunId ?? "",
      workflow: row.workflow,
      status: reply.outcome,
      title,
      ...(reply.ask ? { ask: reply.ask } : {}),
    },
    ...(refs.length > 0 ? { artifacts: refs } : {}),
  });
  logger.info("Job turn delivered", LOG_TAG, {
    runId: row.id,
    jobId,
    status: reply.outcome,
    artifacts: refs.length,
    dropped: dropped.length,
    result,
  });

  // The Stop button: this run is no longer something to stop.
  if (row.conversationId) {
    try {
      const { clearActiveRun, notifyRunActive } = await import("@/services/canvas-active-runs-hooks");
      const { wasLast } = await clearActiveRun(row.conversationId, row.id);
      if (wasLast) await notifyRunActive(row.conversationId, false);
    } catch (err) {
      logger.warn("clearActiveRun failed after a job turn (non-fatal)", LOG_TAG, {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
