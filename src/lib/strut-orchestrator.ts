/**
 * Jamie on strut's `orchestrator` workflow — what hive and the workflow
 * agree on (strut `src/workflows/orchestrator.yaml`, `specs/API.md` §12,
 * `specs/CALLBACKS.md` §6; the launch in `services/strut-orchestrator.ts`,
 * the completion handler in `services/strut-runs/orchestrator-turn.ts`, the
 * card in `_components/StrutProposalCard.tsx`). Pure: no server or client
 * imports, so both sides can use it.
 *
 * Jamie runs on it (`docs/jamie-engine.md`): each turn of an org
 * conversation is ONE run of the workflow, with the
 * conversation's row id as the `session`: strut's agent remembers the
 * conversation itself, so nothing is replayed to it. Its reply comes back
 * through the strut-runs webhook in the job turn's shape — `{ text,
 * artifacts, ask?, cost, session }` — plus `proposals[]`: the gated graph
 * writes it asked for, recorded on strut rather than run, which a person
 * accepts or rejects from the card (`POST /proposals/:id/decide`).
 */

import { z } from "zod";
import type { ConceptKind, GraphEdgeEndpoint, ProposalOutput } from "@/lib/proposals/types";
import { JOB_WORKFLOW, isStrutPeerId } from "@/lib/strut-jobs";

/** `StrutRun.kind` of an orchestrator turn — the completion handler's discriminator. */
export const ORCHESTRATOR_TURN_KIND = "orchestrator_turn";
/** Strut's own workflow, seeded at boot (the lab appends the graph tools). */
export const ORCHESTRATOR_WORKFLOW = "orchestrator";

/** The workflow `input` a turn is launched with. */
export const orchestratorTurnInputSchema = z
  .object({
    prompt: z.string(),
    session: z.string().optional(),
    context: z.object({ line: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * The message as the lab's orchestrator reads it: its first line names the
 * Hive workspace this strut belongs to, `@<slug>` — the line a job launch
 * composes too (stakgraph `mcp/src/lab/orchestrator/seed.ts`).
 */
export function orchestratorPrompt(workspaceSlug: string, message: string): string {
  return `@${workspaceSlug}\n${message}`;
}

/**
 * `context.line`: what the host knows about the turn, put before the prompt
 * — the time and the person's time zone (`"Sun 19 Oct 14:02, Europe/London. "`).
 * An unknown zone falls back to UTC.
 */
export function orchestratorContextLine(now: Date, timeZone: string | undefined): string {
  const zone = timeZone?.trim() || "UTC";
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(now);
  try {
    return `${format(zone)}, ${zone}. `;
  } catch {
    return `${format("UTC")}, UTC. `;
  }
}

/**
 * Appended to `context.line` on a turn asked on a voice call
 * (`/api/calls/turn`): where the reply goes and how it is heard. The
 * speaker's name before the message is what the call shows, typed in by
 * whoever joined, so it is not an identity.
 */
export const ORCHESTRATOR_CALL_LINE =
  "On a voice call. Your reply goes to the call's chat and may be read aloud: say it the way you would out loud, " +
  "short, with what matters first; links and detail belong in artifacts. " +
  "Names before a message are what the call shows, not verified. ";

/**
 * Appended to `context.line` on a turn in a Sphinx tribe — a mention
 * (`/api/tribes/messages`, with the asker's alias) or a wake on the tribe's
 * conversation (`strut-orchestrator-wake.ts`, no asker): where the reply
 * goes, who reads it, and how. A tribe is read on a phone, so the reply is
 * a text message — the call line's posture, for a chat; past
 * `MAX_TRIBE_TEXT_CHARS` the outbox cuts it. A tribe tells members apart by
 * alias only, so the name is not an identity; the owner flag is the tribe
 * server's.
 */
export function orchestratorTribeLine(tribe: { name: string | null; alias?: string; owner?: boolean }): string {
  const where = tribe.name ? `the Sphinx tribe #${tribe.name}` : "a Sphinx tribe";
  const by = tribe.owner ? `${tribe.alias} (the tribe's owner)` : tribe.alias;
  return (
    (tribe.alias ? `Asked in ${where} by ${by}. ` : `In ${where}. `) +
    "Your reply is posted there, where not everyone is in this org, and read on a phone: say it the way you would in a " +
    "text message, short, with what matters first; links and detail belong in artifacts, and a long reply is cut. " +
    (tribe.alias ? "Names before a message are what the tribe shows, not verified. " : "")
  );
}

/** How a reply row shows the agent's question (`renderOrchestratorContent`). */
export const orchestratorAskLine = (ask: string): string => `**Question for you:** ${ask}`;

// ─── Rows ────────────────────────────────────────────────────────────────

/** The reply row of a turn — also its idempotency key. */
export const orchestratorRowId = (runId: string): string => `orchestrator-${runId}`;
/** The launch marker a turn hangs its working card on until the reply row lands. */
export const orchestratorLaunchRowId = (runId: string): string => `orchestrator-launch-${runId}`;
/** One row per proposal the turn made. */
export const strutProposalRowId = (runId: string, proposalId: string): string =>
  `orchestrator-${runId}-proposal-${proposalId}`;

/**
 * How the turn ended, as the row's `source.status` says it. `silent` is a
 * successful turn whose whole reply was `ORCHESTRATOR_SILENT_MARKER`: the
 * row is appended (the working card hangs on it) and shown as nothing.
 */
export type OrchestratorTurnOutcome = "success" | "silent" | "error" | "cancelled" | "lost";

/**
 * The stay-silent convention. The orchestrator answers only in text (no
 * tool hive could watch), so a wake that needs no visible reply — a job
 * the user stopped, a one-line entry — asks for exactly this marker and
 * nothing else; `services/strut-runs/orchestrator-turn.ts` turns it into
 * a `silent` row. Tolerant of quoting and a trailing stop.
 */
export const ORCHESTRATOR_SILENT_MARKER = "[silent]";
const SILENT_REPLY = /^[\s`'"*_]*\[silent\][\s`'"*_.]*$/i;
export function isOrchestratorSilentReply(text: string | undefined): boolean {
  return typeof text === "string" && SILENT_REPLY.test(text);
}

/** The reply of one turn (`services/strut-runs/orchestrator-turn.ts`). */
export type OrchestratorRowSource = {
  kind: "orchestrator";
  /** The turn's `StrutRun` id. */
  runId: string;
  strutRunId: string;
  status: OrchestratorTurnOutcome;
  /** The agent stopped for a decision: the question, verbatim. */
  ask?: string;
  /**
   * The jobs this turn started or continued (`job/start`, `job/continue`),
   * read from the run's event log when it settled. Each is a job turn
   * strut is still working on: the chat hangs a running card under this
   * row until the job's own row (`job-<runId>`) lands.
   */
  jobs?: OrchestratorJobLaunch[];
};

/**
 * A reply's deliverables as strut answered them (`GET …/runs/<runId>/artifacts`,
 * strut `specs/CALLBACKS.md` §4), beside the workspace whose strut ran the
 * turn: what a reader that knows strut (Peel) opens them against. Kept on
 * the reply row as it came and handed on to a call untouched — hive's own
 * `ArtifactRef`s stay the canvas's (sphinx-voice `plans/call-artifacts.md`).
 */
export interface StrutArtifactEnvelope {
  workspace: string;
  artifacts: Record<string, unknown>[];
  /**
   * Proposals the message is about: on a proposal's post, the one it asks
   * for (with strut's `card`); on a decision's, the outcome (no card). The
   * ids are that workspace's strut's, the `url` strut-relative. A reader
   * that knows only `artifacts` reads the envelope as before.
   */
  proposals?: StrutProposalEntry[];
}

/** A proposal in an envelope (`StrutArtifactEnvelope.proposals`). */
export interface StrutProposalEntry {
  id: string;
  step: string;
  title: string;
  status: StrutProposalStatus;
  summary?: string;
  /** strut's card as the run reported it (`StrutProposalCard` at `v: 1`); none from an older strut. */
  card?: Record<string, unknown>;
  /** Strut-relative: `/proposals/<id>`. */
  url?: string;
  rationale?: string;
  createdAt?: string;
  /** A failed one: what went wrong. */
  error?: string;
}

/** The most entries an envelope keeps (the canvas keeps as many refs). */
const MAX_STRUT_ENTRIES = 20;

/**
 * Strut's entries that are references, as they came: an entry with an
 * `error` (strut could not resolve it) and one that is only inline
 * `content` (no `url`, `path` or `app`) are left out, never rewritten.
 */
export function strutReferenceEntries(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const isRef = (e: Record<string, unknown>) =>
    e.error === undefined &&
    ((typeof e.url === "string" && e.url !== "") ||
      (typeof e.path === "string" && e.path !== "") ||
      (typeof e.app === "object" && e.app !== null));
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    .filter(isRef)
    .slice(0, MAX_STRUT_ENTRIES);
}

/**
 * A stored envelope, when it has a workspace and entries — deliverables, or
 * proposals beside an `artifacts` list that may be empty; its entries are
 * not looked into.
 */
export function parseStrutArtifactEnvelope(value: unknown): StrutArtifactEnvelope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.workspace !== "string" || !v.workspace || !Array.isArray(v.artifacts)) return undefined;
  const proposals = Array.isArray(v.proposals) && v.proposals.length > 0;
  if (v.artifacts.length === 0 && !proposals) return undefined;
  return value as StrutArtifactEnvelope;
}

/** A job turn an orchestrator turn launched inside strut. */
export type OrchestratorJobLaunch = {
  jobId: string;
  title: string;
  /** The job turn's `StrutRun` id — the row minted for it before it lands. */
  runId: string;
  /** A workflow build on another workspace's strut: that workspace's slug (`job/start`'s `peer`). */
  peer?: string;
};

/** A `job/start` or `job/continue` call as the run's event log records it. */
export interface OrchestratorJobCall {
  job: string;
  /** Strut's run id of the job turn the call launched. */
  runId: string;
  title?: string;
  /**
   * The job-shaped workflow a `job/start` launched — its `workflow` input,
   * `job` when it named none (strut plans/builder-job.md §2). Absent for a
   * `job/continue`, which launches whatever the job's record says.
   */
  workflow?: string;
  /** The strut a `job/start` builds on when it is another one: its `peer` input, a workspace slug. */
  peer?: string;
}

/** The tool names strut's agent gives the two steps (`job/start` → `job_start`). */
const JOB_START_TOOL = "tool:job_start";
const JOB_LAUNCH_TOOLS: ReadonlySet<string> = new Set([JOB_START_TOOL, "tool:job_continue"]);

const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * The job turns a settled orchestrator run launched, in call order, from its
 * event log (`GET …/runs/<runId>/events`): each agent tool call is a
 * `step.start` (`stepType: "tool:job_start"`, the call's input) and a
 * `step.end` at the same path (the step's `{ job, runId, callback }`,
 * JSON-encoded). A call that failed has no `step.end` and draws nothing; a
 * job launched twice keeps its last turn (one turn at a time per job). A
 * `job/start` carries the workflow its input named, and its `peer`.
 */
export function parseOrchestratorJobCalls(events: unknown[]): OrchestratorJobCall[] {
  const inputs = new Map<string, Record<string, unknown>>();
  const calls = new Map<string, OrchestratorJobCall>();
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { type?: unknown; path?: unknown; stepType?: unknown; input?: unknown; output?: unknown };
    if (typeof e.path !== "string" || typeof e.stepType !== "string" || !JOB_LAUNCH_TOOLS.has(e.stepType)) continue;
    if (e.type === "step.start") {
      const input = parseMaybeJson(e.input);
      if (input && typeof input === "object") inputs.set(e.path, input as Record<string, unknown>);
      continue;
    }
    if (e.type !== "step.end") continue;
    const out = parseMaybeJson(e.output) as { job?: unknown; runId?: unknown } | undefined;
    const job = nonEmpty(out?.job);
    const runId = nonEmpty(out?.runId);
    if (!job || !runId) continue;
    const input = inputs.get(e.path);
    const title = nonEmpty(input?.title);
    // What `job/start` launches when its input names no workflow is strut's `job`.
    const workflow = e.stepType === JOB_START_TOOL ? (nonEmpty(input?.workflow) ?? JOB_WORKFLOW) : undefined;
    const named = input?.peer;
    const peer = e.stepType === JOB_START_TOOL && isStrutPeerId(named) ? named : undefined;
    calls.delete(job);
    calls.set(job, { job, runId, ...(title ? { title } : {}), ...(workflow ? { workflow } : {}), ...(peer ? { peer } : {}) });
  }
  return [...calls.values()];
}

/** Written as the turn launches; the working card hangs on it until `orchestrator-<runId>` lands. */
export type OrchestratorLaunchRowSource = {
  kind: "orchestrator_launch";
  runId: string;
  /**
   * The turn was a WAKE, not a person's message: the job row it reacts to
   * (`job-<StrutRun.id>`, `services/strut-orchestrator-wake.ts`). The wake's
   * idempotency mark — one launch per job row, ever.
   */
  wakeId?: string;
};

/**
 * Rounds of the job loop in the transcript tail, for the orchestrator
 * wake's loop breaker: job rows (each a turn that landed and woke the
 * orchestrator, which may continue the job and land another) back to the
 * last human message, which resets the window.
 */
export function countTrailingJobRows(
  messages: ReadonlyArray<{ role?: string; source?: { kind?: string } | null }>,
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    if (m.source?.kind === "job") count++;
  }
  return count;
}

export const STRUT_PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "applied", "failed"] as const;
export type StrutProposalStatus = (typeof STRUT_PROPOSAL_STATUSES)[number];

/**
 * One proposal a turn made (strut CALLBACKS.md §6): the brief as the run
 * reported it. The card reads the record live (`GET …/strut/proposals/:id`);
 * `status` here is the status at delivery, kept for the readout.
 */
export type StrutProposalRowSource = {
  kind: "proposal";
  /** The turn's `StrutRun` id — what the card's reads are scoped by. */
  runId: string;
  proposalId: string;
  /** Strut-relative: `/proposals/<id>`. */
  url: string;
  /** The registry step the proposal will run — what picks the card's body. */
  step: string;
  status: StrutProposalStatus;
  title: string;
  /** What the step's `describe` read for the card at proposal time. */
  summary?: string;
  /** strut's card as the run reported it (read with `strutProposalCardOf`); none from an older strut. */
  card?: Record<string, unknown>;
  rationale?: string;
  createdAt?: string;
  /** The slug of the workspace whose strut ran the turn: what the proposal's id is relative to. */
  workspace?: string;
};

/** A person's decision on a proposal, as the decide route recorded it. */
export type StrutProposalResultRowSource = {
  kind: "proposal_result";
  runId: string;
  proposalId: string;
  status: StrutProposalStatus;
  title: string;
  /** The proposal's step; none on a row from before tribes were told the outcome. */
  step?: string;
  /** A failed one: what went wrong. */
  error?: string;
  /** As on the proposal's row. */
  workspace?: string;
};

/**
 * What a person decides on (strut API.md §12, `src/proposal-card.ts`):
 * computed by strut once, at proposal time, for a host to draw without
 * knowing the step. `full` is true when `fields` cover everything that will
 * run.
 */
export interface StrutProposalCard {
  v: 1;
  title: string;
  summary?: string;
  fields: StrutProposalCardField[];
  actions: { accept: string; reject: string };
  full: boolean;
}

export interface StrutProposalCardField {
  label: string;
  value: string;
  kind?: "text" | "code" | "markdown" | "ref";
  danger?: boolean;
}

/** The slim form strut reports a run's proposals in (`run.end { proposals }`, `GET …/runs/:runId/proposals`). */
export interface StrutProposalBrief {
  id: string;
  step: string;
  title: string;
  status: StrutProposalStatus;
  url: string;
  summary?: string;
  /** strut's card as it came, a plain object under `MAX_CARD_CHARS` of JSON. */
  card?: Record<string, unknown>;
  rationale?: string;
  createdAt?: string;
  decidedAt?: string;
}

const MAX_ID = 200;
const MAX_TITLE = 300;
const MAX_RATIONALE = 2_000;
const MAX_SUMMARY = 4_000;
/** strut caps a card at 12 fields of 500 characters; this is the room for its labels and the JSON. */
const MAX_CARD_CHARS = 16_000;
const CARD_MAX_FIELDS = 12;
const CARD_MAX_VALUE = 500;
const CARD_FIELD_KINDS = new Set(["text", "code", "markdown", "ref"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
const cut = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v) : undefined;

/** A card kept as it came: a plain object small enough to store and hand on; anything else is none. */
function keptCard(v: unknown): Record<string, unknown> | undefined {
  if (!isRecord(v)) return undefined;
  try {
    return JSON.stringify(v).length <= MAX_CARD_CHARS ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A card hive can draw: strut's `v: 1`, its fields under strut's own caps.
 * Null for none, or one hive cannot read (another version, a field that is
 * not label and value): the host then draws what it drew before cards.
 */
export function strutProposalCardOf(raw: unknown): StrutProposalCard | null {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.title !== "string" || !Array.isArray(raw.fields)) return null;
  const actions = isRecord(raw.actions) ? raw.actions : null;
  const word = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (!actions || !word(actions.accept) || !word(actions.reject)) return null;
  const fields: StrutProposalCardField[] = [];
  for (const f of raw.fields.slice(0, CARD_MAX_FIELDS)) {
    if (!isRecord(f) || typeof f.label !== "string" || typeof f.value !== "string") return null;
    fields.push({
      label: f.label,
      value: f.value.length > CARD_MAX_VALUE ? `${f.value.slice(0, CARD_MAX_VALUE - 1)}…` : f.value,
      ...(typeof f.kind === "string" && CARD_FIELD_KINDS.has(f.kind)
        ? { kind: f.kind as StrutProposalCardField["kind"] }
        : {}),
      ...(f.danger === true ? { danger: true } : {}),
    });
  }
  return {
    v: 1,
    title: raw.title,
    ...(typeof raw.summary === "string" && raw.summary.trim() ? { summary: raw.summary } : {}),
    fields,
    actions: { accept: String(actions.accept).trim(), reject: String(actions.reject).trim() },
    // Anything left out here, or not said, is not everything.
    full: raw.full === true && raw.fields.length <= CARD_MAX_FIELDS,
  };
}

export function parseStrutProposalStatus(v: unknown): StrutProposalStatus {
  return typeof v === "string" && (STRUT_PROPOSAL_STATUSES as readonly string[]).includes(v)
    ? (v as StrutProposalStatus)
    : "pending";
}

/** Strut's list as it comes: every brief that is whole, in order. */
export function parseStrutProposalBriefs(raw: unknown): StrutProposalBrief[] {
  if (!Array.isArray(raw)) return [];
  const out: StrutProposalBrief[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id, MAX_ID);
    const step = str(entry.step, MAX_ID);
    if (!id || !step) continue;
    const summary = cut(entry.summary, MAX_SUMMARY);
    const card = keptCard(entry.card);
    out.push({
      id,
      step,
      title: str(entry.title, MAX_TITLE) ?? step,
      status: parseStrutProposalStatus(entry.status),
      url: str(entry.url, 1_024) ?? `/proposals/${id}`,
      ...(summary ? { summary } : {}),
      ...(card ? { card } : {}),
      ...(str(entry.rationale, MAX_RATIONALE) ? { rationale: str(entry.rationale, MAX_RATIONALE) } : {}),
      ...(str(entry.createdAt, 64) ? { createdAt: str(entry.createdAt, 64) } : {}),
      ...(str(entry.decidedAt, 64) ? { decidedAt: str(entry.decidedAt, 64) } : {}),
    });
  }
  return out;
}

/**
 * The record `GET /proposals/:id` gives (strut API.md §12), as hive's route
 * hands it to the card — `by.actor` / `by.principal` dropped, the run's
 * workspace slug added for the card's subtext.
 */
export interface StrutProposalRecord {
  id: string;
  step: string;
  input: unknown;
  rationale?: string;
  title: string;
  summary?: string;
  /** strut's card, when it has one hive can draw (`strutProposalCardOf`). */
  card?: StrutProposalCard;
  status: StrutProposalStatus;
  createdAt: string;
  by: { workflow: string; runId: string; path?: string; job?: string; session?: string };
  decision?: { action: "accept" | "reject"; by?: string; at: string; input?: unknown; reason?: string };
  result?: { output?: unknown; error?: string; cost?: number; at: string };
  /** The slug of the workspace whose swarm ran the proposing turn. */
  workspaceSlug?: string;
}

// ─── The card's body ─────────────────────────────────────────────────────

const edgeEndpoint = (refId: unknown, type: unknown, data: unknown): GraphEdgeEndpoint | null => {
  if (typeof refId === "string" && refId) return { ref_id: refId };
  if (typeof type === "string" && type) return { node_type: type, node_data: isRecord(data) ? data : {} };
  return null;
};

const triplet = (t: Record<string, unknown>) => {
  const source = edgeEndpoint(t.source_ref_id, t.source_type, t.source_data);
  const target = edgeEndpoint(t.target_ref_id, t.target_type, t.target_data);
  if (!source || !target || typeof t.edge_type !== "string") return null;
  return {
    edge_type: t.edge_type,
    ...(isRecord(t.edge_data) ? { edge_data: t.edge_data } : {}),
    ...(typeof t.weight === "number" ? { weight: t.weight } : {}),
    source,
    target,
  };
};

/** The knowledge kinds a `concept/create` input may name: hive's `ConceptKind`. */
const CONCEPT_KINDS = new Set<string>([
  "preference",
  "best_practice",
  "gotcha",
  "process",
  "general",
] satisfies ConceptKind[]);

/**
 * A strut proposal's step + input as the hive proposal kind whose card body
 * draws the same fields (strut's flat `source_ref_id` / `source_type` +
 * `source_data` becomes hive's endpoint union). Null when no hive body
 * fits — the card then shows the input as key/value pairs. Render-only:
 * the decision goes to strut, never through hive's approval handler.
 */
export function strutProposalToOutput(step: string, input: unknown, workspaceSlug = ""): ProposalOutput | null {
  if (!isRecord(input)) return null;
  const proposalId = "strut";
  const scope = { workspaceId: "", workspaceSlug };
  switch (step) {
    case "concept/create": {
      // The lab's Concept step (stakgraph `mcp/src/lab/orchestrator`): hive's
      // own Concept card body. Its `docs` is the body hive's payload calls
      // `documentation`; `parent` is a ref_id or an exact name on strut.
      if (typeof input.name !== "string" || !input.name) return null;
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const description = str(input.description);
      const repo = str(input.repo);
      const parent = str(input.parent);
      const kind = str(input.kind);
      return {
        kind: "conceptCreate",
        proposalId,
        payload: {
          ...scope,
          name: input.name,
          documentation: typeof input.docs === "string" ? input.docs : "",
          ...(description ? { description } : {}),
          ...(repo ? { repo } : {}),
          ...(parent ? { parent } : {}),
          ...(kind && CONCEPT_KINDS.has(kind) ? { kind: kind as ConceptKind } : {}),
        },
        meta: { workspaceSlug, ...(kind ? { kind } : {}) },
      };
    }
    case "graph/create-node":
      return typeof input.node_type === "string"
        ? {
            kind: "graphNodeCreate",
            proposalId,
            payload: {
              ...scope,
              node_type: input.node_type,
              node_data: isRecord(input.node_data) ? input.node_data : {},
            },
            meta: { workspaceSlug },
          }
        : null;
    case "graph/create-triplet": {
      const t = triplet(input);
      return t
        ? { kind: "graphTripletCreate", proposalId, payload: { ...scope, ...t }, meta: { workspaceSlug } }
        : null;
    }
    case "graph/create-batch-triplet": {
      if (!Array.isArray(input.triplets)) return null;
      const triplets = input.triplets
        .filter(isRecord)
        .map(triplet)
        .filter((t): t is NonNullable<typeof t> => t !== null);
      return triplets.length > 0
        ? { kind: "graphBatchTripletCreate", proposalId, payload: { ...scope, triplets }, meta: { workspaceSlug } }
        : null;
    }
    case "graph/move-node":
      return typeof input.ref_id === "string" &&
        typeof input.to_ref_id === "string" &&
        typeof input.edge_type === "string"
        ? {
            kind: "graphNodeMove",
            proposalId,
            payload: {
              ...scope,
              ref_id: input.ref_id,
              edge_type: input.edge_type,
              from_ref_id: typeof input.from_ref_id === "string" ? input.from_ref_id : "",
              to_ref_id: input.to_ref_id,
            },
            meta: { workspaceSlug },
          }
        : null;
    case "graph/delete-edge":
      return typeof input.source_ref_id === "string" &&
        typeof input.edge_type === "string" &&
        typeof input.target_ref_id === "string"
        ? {
            kind: "graphEdgeDelete",
            proposalId,
            payload: {
              ...scope,
              edge_type: input.edge_type,
              source_ref_id: input.source_ref_id,
              target_ref_id: input.target_ref_id,
            },
            meta: { workspaceSlug },
          }
        : null;
    default:
      return null;
  }
}

/** The card's label for a step: `graph/create-node` → "Proposed graph node". */
export function strutProposalStepLabel(step: string): string {
  switch (step) {
    case "concept/create":
      return "Proposed new Concept";
    case "graph/create-node":
      return "Proposed new graph node";
    case "graph/edit-node":
      return "Proposed graph node edit";
    case "graph/create-triplet":
      return "Proposed graph relationship";
    case "graph/create-batch-triplet":
      return "Proposed batch graph relationships";
    case "graph/move-node":
      return "Proposed node move";
    case "graph/delete-edge":
      return "Proposed link removal";
    case "graph/delete-node":
      return "Proposed node delete";
    default:
      return `Proposed ${step}`;
  }
}

/** The notice a person sees when strut is still on their previous message. */
export const ORCHESTRATOR_BUSY_NOTE =
  "Still working on your last message — its reply will land here when it ends. Send this one again after that.";
