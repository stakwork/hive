/**
 * Artifacts in the org-canvas (Jamie) chat: what an agent hands the reader
 * to look at — a plan, a screenshot, a pod's browser, a pull request —
 * rather than prose to read.
 *
 * Two halves, kept apart on purpose:
 *
 * - An `ArtifactRef` is what a message carries (`CanvasChatMessage.artifacts`):
 *   what the artifact is, and a pointer to where its content lives. It is
 *   small, it is stored with the conversation, and it is all a card needs to
 *   name the artifact.
 * - An artifact's content is what a viewer draws (`ArtifactContents`). It is
 *   read through the loader (`_components/artifacts/useArtifactContent.ts`)
 *   when someone looks, and never stored on the message.
 *
 * `kind` names how Hive shows the artifact, never what the job was. A plan
 * is `markdown`, a screenshot is `image`, a pod or a web page is `url`.
 * What the artifact is to the reader goes in `label`, which is displayed
 * and never switched on. Adding a kind means an entry in `ArtifactContents`
 * with its parser here, and an entry in the viewer registry
 * (`_components/artifacts/registry.ts`).
 *
 * A ref on a later message is the same artifact when it resolves to the
 * same thing (`artifactIdentity`): a job's file by its swarm and key, a
 * pull request by repo and number, a stored page by its slug, an address
 * by its URL — whatever the agent named it that turn. Only content frozen
 * on the message goes by `id`, and only there is a later copy a version
 * with something new in it. The chat shows an artifact once, under the
 * message that reported it last.
 *
 * Refs come out of stored JSON and content out of other systems, so both
 * are parsed here before anything renders them: what does not fit is
 * dropped, never repaired.
 */
import type { Action, ActionResult, DiffContent } from "@/lib/chat";
import { parseGraphChanges, type GraphChange } from "@/components/graph-workbench/changes";
import { bounded } from "@/lib/strut-chat-activity";
import { proposalGraphArtifacts } from "./proposalGraphArtifacts";

// ─── Kinds and their content ────────────────────────────────────────────

const PULL_REQUEST_STATES = ["open", "draft", "merged", "closed"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

const CHECK_STATUSES = ["success", "failure", "pending", "skipped"] as const;
export interface PullRequestCheck {
  name: string;
  status: (typeof CHECK_STATUSES)[number];
  /** The check's own page — a check run's `html_url`, a commit status's `target_url` — so an event about a failure can point at it. */
  url?: string;
}

/** A check's outcome on the latest pass over a job's claims (strut's `LastVerify`). */
export type ClaimCheckOutcome =
  | { ran: true }
  | { pending: true }
  /** An external check waiting on a person: the open slot's evidence id. */
  | { planned: string }
  /** `superseded`: the pass was for a turn that is no longer the newest. */
  | { skipped: string; reason?: string };

export interface JobClaimCheck {
  id: string;
  name: string;
  /** Answered by a person or an outside system, not run by a tool. */
  external?: boolean;
  /** What an external check asks — the to-do's question. */
  description?: string;
  lastVerify?: ClaimCheckOutcome;
}

/** One claim about a strut job (strut's `LedgerClaim`, with the listing's speaker and open slots). */
export interface JobClaim {
  id: string;
  /** What the work must deliver, one sentence. */
  text: string;
  status: "supported" | "refuted" | "stale" | "unknown";
  /** Who stated it: `ai` (the job's agent) or `person`. */
  speaker?: string;
  /** The verdict rests on a person's or a model's word — nothing observed. */
  assertedOnly: boolean;
  /** Checks with no verdict about the newest turn. */
  unverified: number;
  latest?: {
    content?: string;
    /** `observed` (an instrument measured it) or `asserted`. */
    mode?: string;
    /** Seconds. */
    observedAt?: number;
    checkVersion?: string;
    /** The turn the verdict is about — a strut run id. */
    about?: string;
    /** What the check pointed at: a job file (a screenshot) or an endpoint. */
    locator?: { url?: string; file?: string };
  };
  checks: JobClaimCheck[];
  /** External checks waiting on a person: the evidence to answer, the turn it is on, the question. */
  slots: Array<{ evidence: string; check?: string; runId?: string; question?: string }>;
}

/** The claim waits on a person's look — an open slot, and nothing has refuted it. Counted and shown as that, never also as `unknown`. */
export const claimNeedsLook = (claim: Pick<JobClaim, "status" | "slots">): boolean => claim.slots.length > 0 && claim.status !== "refuted";

/** What a viewer draws, for each kind. */
export interface ArtifactContents {
  markdown: { text: string };
  /**
   * A page, never the markup itself: a stored HTML page by its slug in the
   * conversation's org, or a page a strut job wrote by where it is on the
   * swarm — `swarmId` and strut's own link, what the ref's `graph` source
   * says. `HtmlArtifactFrame` reads either through its proxy and renders
   * the bytes in a sandboxed frame, scripts on.
   */
  html:
    | {
        slug: string;
        /** Changes when the page is rewritten, so an open frame refetches it. */
        updatedAt?: string;
      }
    | { swarmId: string; key: string };
  image: { url: string; alt?: string };
  video: { url: string; poster?: string };
  audio: { url: string };
  pdf: { url: string };
  /** Somewhere to browse: a pod's app, a preview deploy, a web page. */
  url: { url: string };
  diff: DiffContent;
  /** The pull request's title is the artifact's own. */
  pull_request: {
    /** The pull request on GitHub. */
    url: string;
    /** `owner/name`. */
    repo: string;
    number: number;
    state: PullRequestState;
    author?: string;
    headBranch?: string;
    baseBranch?: string;
    /** The head commit the checks are for. */
    headSha?: string;
    /** The description, as markdown. */
    body?: string;
    checks?: PullRequestCheck[];
    /** The files changed, when the producer has them. */
    diffs?: ActionResult[];
  };
  code: {
    code: string;
    /** Highlighting follows `language`, else the extension of `filename`. */
    language?: string;
    filename?: string;
  };
  log: { text: string };
  json: { value: unknown };
  /**
   * A workspace's knowledge graph, opened on the graph workbench — centred on
   * `focus` when given, with `changes` drawn on it. `proposal` is the id of
   * the proposal those changes are, so the view can follow its decision.
   * `layout: "tree"` opens a left-to-right tree of `label` nodes (default
   * `Choice`) below `focus` instead — the brainstorm tree (`ChoiceTree`).
   */
  graph: {
    workspace: string;
    focus?: string;
    changes?: GraphChange[];
    proposal?: string;
    layout?: "tree";
    label?: string;
  };
  /**
   * What a strut run did in a workspace's knowledge graph, call by call —
   * the run graph (`components/strut-run-graph`), read live from the run's
   * workspace. `run` is the run's `StrutRun` id; `calls` and `nodes` count
   * what it had touched when the ref was written, for the card.
   */
  run_graph: { workspace: string; run: string; calls?: number; nodes?: number };
  /**
   * The lineage of one highlighted span of an output — a number, a
   * phrase, a few lines of code — from a Jamie reply or a strut run:
   * the step or tool call that produced it, the chain back to its
   * sources, and the later steps that used it, when it came from a
   * middle step. Built by `services/trace`; labelled "Lineage" in the
   * registry so it is not confused with `run_graph`'s own "trace" wording.
   */
  trace: { selection: string; origin: TraceOrigin; upstream: TraceLink[]; downstream: TraceLink[] };
  /**
   * A strut job's CLAIMS (strut plans/job-claims.md): what the work must
   * deliver and whether it does, as of a turn — read from the job's swarm
   * after the turn (`GET {lab}/jobs/<job>/claims`), one card per job, each
   * turn and each action on the card a version. `turn` is the strut run id
   * the snapshot is of; `swarmId` is where a verdict's screenshot is read
   * (the reader route); `turns` numbers the turns for "verified on turn N".
   */
  claims: {
    workspace: string;
    swarmId: string;
    job: string;
    turn: string;
    turns?: Record<string, number>;
    claims: JobClaim[];
  };
  /**
   * A recording a strut job made of a flow (`browser/walkthrough`, strut
   * plans/live-artifacts.md §4): a directory of frames and the manifest
   * naming them, where it is on the swarm. The viewer reads the manifest
   * through the reader route, scrubs the frames, and reads it again when
   * the job reports a new frame.
   */
  walkthrough: { swarmId: string; key: string };
  /**
   * A captcha a strut job hit and cannot solve: the manifest (a json file in
   * the job's folder) names the cropped image, the instruction, the site and
   * whether a person taps tiles or types text. The viewer reads the manifest
   * through the reader route and resolves the image beside it.
   */
  captcha: {
    manifest: { swarmId: string; key: string };
    image?: { swarmId: string; key: string };
    instruction?: string;
    site?: string;
    mode?: "tap" | "text" | "either";
    round?: number;
    maxRounds?: number;
    askedAt?: string;
    expiresAt?: string;
    grid?: { rows: number; cols: number };
    state?: "waiting" | "sent" | "solved" | "failed" | "expired";
  };
}

/** One node a trace link's step read or wrote, when it touched the graph. */
export interface TraceNode {
  ref_id: string;
  node_type?: string;
}

const TRACE_MATCH_KINDS = ["exact", "inferred"] as const;
export type TraceMatchKind = (typeof TRACE_MATCH_KINDS)[number];

/**
 * One step in a trace's chain: the tool call or step that produced or used
 * the selection. `toolCallId` names a Jamie tool-call row; `path` names a
 * strut event's path. `match` is `"exact"` when the excerpt holds the
 * selection verbatim (after whitespace/number normalizing), else
 * `"inferred"` — a model's best guess, never a value it computed itself
 * made exact.
 */
export interface TraceLink {
  toolCallId?: string;
  path?: string;
  toolName: string;
  excerpt: string;
  match: TraceMatchKind;
  nodes?: TraceNode[];
}

const TRACE_ORIGIN_KINDS = ["jamie", "strut"] as const;
export type TraceOriginKind = (typeof TRACE_ORIGIN_KINDS)[number];

/** Where the highlighted selection itself was read from. */
export interface TraceOrigin {
  kind: TraceOriginKind;
  conversationId?: string;
  messageId?: string;
  workspace?: string;
  run?: string;
}

export type ArtifactKind = keyof ArtifactContents;

// ─── The ref a message carries ──────────────────────────────────────────

/**
 * Where an artifact's content lives. Only the loader reads this.
 *
 * - `inline` — the content is right here. For what is itself only an
 *   address (a `url`), or small enough not to be worth a round trip.
 * - `graph` — an Artifact node in a swarm's graph. The swarm is part of
 *   the pointer, so a ref still resolves if jobs move between swarms.
 */
export type ArtifactSource =
  | { type: "inline"; content: Record<string, unknown> }
  | { type: "graph"; swarmId: string; key: string };

export interface ArtifactRef {
  /** The writer's name for it. Groups the snapshots of inline content into versions; what is read from elsewhere goes by where (`artifactIdentity`). */
  id: string;
  kind: ArtifactKind;
  title: string;
  /** What this is to the reader — "Plan", "Screenshot", "Pod". Falls back to the kind's own name. */
  label?: string;
  /** A sentence about what is in it, shown on the card before — and without — its content. */
  summary?: string;
  source: ArtifactSource;
}

/** The two halves together, as a kind's viewer is given them. */
export interface ArtifactViewerProps<K extends ArtifactKind> {
  artifact: ArtifactRef;
  content: ArtifactContents[K];
  /**
   * The strut job that reported the artifact, when a Job row did
   * (`jobIdOfArtifact`): what a viewer's action — the pull-request panel's
   * Fix — sends an event to (strut plans/job-artifact-events.md §5).
   */
  jobId?: string;
}

/** What is on the panel. `version` is the artifact's place among its versions; null follows the newest. */
export interface ArtifactPanelState {
  /** The artifact, by its `artifactIdentity`; null for the index of every artifact in the chat. */
  identity: string | null;
  version: number | null;
  /**
   * Something a strut job is still making (the working card's live strip):
   * shown under `identity` while the chat holds nothing there, and handed
   * over to the chat's own once the turn delivers it under the same link.
   */
  live?: ArtifactRef;
}

// ─── Reading refs out of stored JSON ────────────────────────────────────

const MAX_REFS_PER_MESSAGE = 20;
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 300;
const MAX_LABEL_LENGTH = 60;
const MAX_SUMMARY_LENGTH = 600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An optional part: a string with something in it, else left out. */
const optional = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** `value` when it is one of `allowed`, else null. */
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
  allowed.find((entry) => entry === value) ?? null;

function parseArtifactSource(raw: unknown): ArtifactSource | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "inline") {
    return isRecord(raw.content) ? { type: "inline", content: raw.content } : null;
  }
  if (raw.type === "graph") {
    const swarmId = bounded(raw.swarmId, MAX_ID_LENGTH);
    const key = bounded(raw.key, MAX_ID_LENGTH);
    return swarmId && key ? { type: "graph", swarmId, key } : null;
  }
  return null;
}

function parseArtifactRef(raw: unknown): ArtifactRef | null {
  if (!isRecord(raw)) return null;
  const id = bounded(raw.id, MAX_ID_LENGTH);
  const kind = oneOf(KINDS, raw.kind);
  const title = bounded(raw.title, MAX_TITLE_LENGTH);
  const source = parseArtifactSource(raw.source);
  if (!id || !kind || !title || !source) return null;
  return {
    id,
    kind,
    title,
    label: bounded(raw.label, MAX_LABEL_LENGTH) ?? undefined,
    summary: bounded(raw.summary, MAX_SUMMARY_LENGTH) ?? undefined,
    source,
  };
}

/**
 * A message's artifacts as they come back out of stored JSON: every ref
 * that is whole, in order, and nothing else. Undefined when there are
 * none, so a message without artifacts stays without the field.
 */
export function parseArtifactRefs(raw: unknown): ArtifactRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs = raw
    .slice(0, MAX_REFS_PER_MESSAGE)
    .map(parseArtifactRef)
    .filter((ref): ref is ArtifactRef => ref !== null);
  return refs.length > 0 ? refs : undefined;
}

// ─── Reading content ────────────────────────────────────────────────────

const ACTIONS: readonly Action[] = ["create", "rewrite", "modify", "delete"];

/** A list where every entry parses, else null — one bad file is not a diff with a file missing. */
function parseEach<T>(raw: unknown, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed = raw.map(parse);
  return parsed.every((entry) => entry !== null) ? (parsed as T[]) : null;
}

function parseDiffFile(raw: unknown): ActionResult | null {
  if (!isRecord(raw)) return null;
  const { file, content, repoName } = raw;
  const action = oneOf(ACTIONS, raw.action);
  if (typeof file !== "string" || typeof content !== "string" || typeof repoName !== "string" || !action) return null;
  return { file, action, content, repoName };
}

function parseCheck(raw: unknown): PullRequestCheck | null {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  const status = oneOf(CHECK_STATUSES, raw.status);
  const url = optional(raw.url);
  return status && { name: raw.name, status, ...(url ? { url } : {}) };
}

/** Content whose only required part is an address. */
const address = (raw: Record<string, unknown>): { url: string } | null =>
  typeof raw.url === "string" && raw.url.length > 0 ? { url: raw.url } : null;

const text = (raw: Record<string, unknown>): { text: string } | null =>
  typeof raw.text === "string" ? { text: raw.text } : null;

/** A count, or left out. */
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

const MAX_SELECTION_LENGTH = 2000;
const MAX_EXCERPT_LENGTH = 4000;
const MAX_TOOL_NAME_LENGTH = 200;
const MAX_LINKS = 50;

function parseTraceNode(raw: unknown): TraceNode | null {
  if (!isRecord(raw)) return null;
  const ref_id = bounded(raw.ref_id, MAX_ID_LENGTH);
  return ref_id ? { ref_id, node_type: optional(raw.node_type) } : null;
}

function parseTraceLink(raw: unknown): TraceLink | null {
  if (!isRecord(raw)) return null;
  const toolName = bounded(raw.toolName, MAX_TOOL_NAME_LENGTH);
  const excerpt = bounded(raw.excerpt, MAX_EXCERPT_LENGTH);
  const match = oneOf(TRACE_MATCH_KINDS, raw.match);
  if (!toolName || excerpt === null || !match) return null;
  const nodes = raw.nodes === undefined ? undefined : parseEach(raw.nodes, parseTraceNode);
  if (raw.nodes !== undefined && nodes === null) return null;
  return {
    toolName,
    excerpt,
    match,
    toolCallId: optional(raw.toolCallId),
    path: optional(raw.path),
    ...(nodes ? { nodes } : {}),
  };
}

function parseTraceLinks(raw: unknown): TraceLink[] | null {
  if (raw === undefined) return [];
  const links = parseEach(raw, parseTraceLink);
  return links ? links.slice(0, MAX_LINKS) : null;
}

function parseTraceOrigin(raw: unknown): TraceOrigin | null {
  if (!isRecord(raw)) return null;
  const kind = oneOf(TRACE_ORIGIN_KINDS, raw.kind);
  if (!kind) return null;
  return {
    kind,
    conversationId: optional(raw.conversationId),
    messageId: optional(raw.messageId),
    workspace: optional(raw.workspace),
    run: optional(raw.run),
  };
}

const CLAIM_STATUSES = ["supported", "refuted", "stale", "unknown"] as const;
const MAX_CLAIMS = 100;
const MAX_CLAIM_TEXT = 2_000;
const MAX_CLAIM_CONTENT = 4_000;

/** A string with something in it, at most `max` long — else left out. */
const within = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

function parseClaimOutcome(raw: unknown): ClaimCheckOutcome | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.ran === true) return { ran: true };
  if (raw.pending === true) return { pending: true };
  const planned = within(raw.planned, MAX_ID_LENGTH);
  if (planned) return { planned };
  const skipped = within(raw.skipped, MAX_ID_LENGTH);
  const reason = within(raw.reason, MAX_SUMMARY_LENGTH);
  return skipped ? { skipped, ...(reason ? { reason } : {}) } : undefined;
}

function parseClaimCheck(raw: unknown): JobClaimCheck | null {
  if (!isRecord(raw)) return null;
  const id = within(raw.id, MAX_ID_LENGTH);
  const name = within(raw.name, MAX_TITLE_LENGTH);
  if (!id || !name) return null;
  const description = within(raw.description, MAX_CLAIM_TEXT);
  const lastVerify = parseClaimOutcome(raw.lastVerify);
  return { id, name, ...(raw.external === true ? { external: true } : {}), ...(description ? { description } : {}), ...(lastVerify ? { lastVerify } : {}) };
}

function parseClaimSlot(raw: unknown): JobClaim["slots"][number] | null {
  if (!isRecord(raw)) return null;
  const evidence = within(raw.evidence, MAX_ID_LENGTH);
  if (!evidence) return null;
  const check = within(raw.check, MAX_ID_LENGTH);
  const runId = within(raw.runId, MAX_ID_LENGTH);
  const question = within(raw.question, MAX_CLAIM_TEXT);
  return { evidence, ...(check ? { check } : {}), ...(runId ? { runId } : {}), ...(question ? { question } : {}) };
}

function parseClaimLatest(raw: unknown): JobClaim["latest"] | undefined {
  if (!isRecord(raw)) return undefined;
  const seconds = typeof raw.observedAt === "number" ? raw.observedAt : raw.observed_at;
  const locator = isRecord(raw.locator) ? { url: within(raw.locator.url, MAX_CLAIM_TEXT), file: within(raw.locator.file, MAX_CLAIM_TEXT) } : undefined;
  const latest: NonNullable<JobClaim["latest"]> = {
    content: within(raw.content, MAX_CLAIM_CONTENT),
    mode: within(raw.mode, MAX_ID_LENGTH),
    observedAt: typeof seconds === "number" && Number.isFinite(seconds) ? seconds : undefined,
    checkVersion: within(raw.checkVersion, MAX_ID_LENGTH),
    about: within(raw.about, MAX_ID_LENGTH),
    locator: locator && (locator.url || locator.file) ? locator : undefined,
  };
  return latest;
}

function parseJobClaim(raw: unknown): JobClaim | null {
  if (!isRecord(raw)) return null;
  const id = within(raw.id, MAX_ID_LENGTH);
  const text = within(raw.text, MAX_CLAIM_TEXT);
  const status = oneOf(CLAIM_STATUSES, raw.status);
  if (!id || !text || !status) return null;
  const speaker = within(raw.speaker, MAX_LABEL_LENGTH);
  const latest = parseClaimLatest(raw.latest);
  return {
    id,
    text,
    status,
    ...(speaker ? { speaker } : {}),
    assertedOnly: raw.assertedOnly === true,
    unverified: count(raw.unverified) ?? 0,
    ...(latest ? { latest } : {}),
    checks: Array.isArray(raw.checks) ? raw.checks.map(parseClaimCheck).filter((c): c is JobClaimCheck => c !== null) : [],
    slots: Array.isArray(raw.slots) ? raw.slots.map(parseClaimSlot).filter((s): s is JobClaim["slots"][number] => s !== null) : [],
  };
}

/** A job's claims as they come back — every claim that is whole, the rest dropped. */
export function parseJobClaims(raw: unknown): JobClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CLAIMS).map(parseJobClaim).filter((c): c is JobClaim => c !== null);
}

const CONTENT_PARSERS: { [K in ArtifactKind]: (raw: Record<string, unknown>) => ArtifactContents[K] | null } = {
  markdown: text,
  log: text,
  audio: address,
  pdf: address,
  url: address,
  html: (raw) => {
    const slug = bounded(raw.slug, MAX_ID_LENGTH);
    if (slug) return { slug, updatedAt: optional(raw.updatedAt) };
    const swarmId = bounded(raw.swarmId, MAX_ID_LENGTH);
    const key = bounded(raw.key, MAX_ID_LENGTH);
    return swarmId && key ? { swarmId, key } : null;
  },
  image: (raw) => {
    const base = address(raw);
    return base && { ...base, alt: optional(raw.alt) };
  },
  video: (raw) => {
    const base = address(raw);
    return base && { ...base, poster: optional(raw.poster) };
  },
  diff: (raw) => {
    const diffs = parseEach(raw.diffs, parseDiffFile);
    return diffs && { diffs };
  },
  pull_request: (raw) => {
    const base = address(raw);
    const state = oneOf(PULL_REQUEST_STATES, raw.state);
    const { repo, number } = raw;
    if (!base || !state || typeof repo !== "string") return null;
    if (typeof number !== "number" || !Number.isInteger(number)) return null;
    // Checks and files are all or nothing: a partial list would read as the whole one.
    const checks = raw.checks === undefined ? undefined : parseEach(raw.checks, parseCheck);
    const diffs = raw.diffs === undefined ? undefined : parseEach(raw.diffs, parseDiffFile);
    if (checks === null || diffs === null) return null;
    return {
      ...base,
      repo,
      number,
      state,
      author: optional(raw.author),
      headBranch: optional(raw.headBranch),
      baseBranch: optional(raw.baseBranch),
      headSha: optional(raw.headSha),
      body: optional(raw.body),
      checks,
      diffs,
    };
  },
  code: (raw) =>
    typeof raw.code === "string"
      ? { code: raw.code, language: optional(raw.language), filename: optional(raw.filename) }
      : null,
  json: (raw) => ("value" in raw ? { value: raw.value } : null),
  graph: (raw) => {
    const workspace = bounded(raw.workspace, MAX_ID_LENGTH);
    return workspace
      ? {
          workspace,
          focus: bounded(raw.focus, MAX_ID_LENGTH) ?? undefined,
          changes: parseGraphChanges(raw.changes),
          proposal: bounded(raw.proposal, MAX_ID_LENGTH) ?? undefined,
          layout: raw.layout === "tree" ? ("tree" as const) : undefined,
          label: bounded(raw.label, MAX_ID_LENGTH) ?? undefined,
        }
      : null;
  },
  run_graph: (raw) => {
    const workspace = bounded(raw.workspace, MAX_ID_LENGTH);
    const run = bounded(raw.run, MAX_ID_LENGTH);
    return workspace && run ? { workspace, run, calls: count(raw.calls), nodes: count(raw.nodes) } : null;
  },
  trace: (raw) => {
    const selection = bounded(raw.selection, MAX_SELECTION_LENGTH);
    const origin = parseTraceOrigin(raw.origin);
    if (!selection || !origin) return null;
    const upstream = parseTraceLinks(raw.upstream);
    const downstream = parseTraceLinks(raw.downstream);
    if (upstream === null || downstream === null) return null;
    return { selection, origin, upstream, downstream };
  },
  claims: (raw) => {
    const workspace = bounded(raw.workspace, MAX_ID_LENGTH);
    const swarmId = bounded(raw.swarmId, MAX_ID_LENGTH);
    const job = bounded(raw.job, MAX_ID_LENGTH);
    const turn = bounded(raw.turn, MAX_ID_LENGTH);
    if (!workspace || !swarmId || !job || !turn) return null;
    const turns = isRecord(raw.turns)
      ? Object.fromEntries(Object.entries(raw.turns).filter(([id, n]) => id.length <= MAX_ID_LENGTH && count(n) !== undefined))
      : undefined;
    return { workspace, swarmId, job, turn, ...(turns ? { turns: turns as Record<string, number> } : {}), claims: parseJobClaims(raw.claims) };
  },
  walkthrough: (raw) => {
    const swarmId = bounded(raw.swarmId, MAX_ID_LENGTH);
    const key = bounded(raw.key, MAX_ID_LENGTH);
    return swarmId && key ? { swarmId, key } : null;
  },
  captcha: (raw) => {
    const ref = (v: unknown) => {
      if (!isRecord(v)) return undefined;
      const swarmId = bounded(v.swarmId, MAX_ID_LENGTH);
      const key = bounded(v.key, MAX_ID_LENGTH);
      return swarmId && key ? { swarmId, key } : undefined;
    };
    const manifest = ref(raw.manifest);
    if (!manifest) return null;
    const image = ref(raw.image);
    const instruction = bounded(raw.instruction, 500);
    const site = bounded(raw.site, 253);
    const mode = raw.mode === "tap" || raw.mode === "text" || raw.mode === "either" ? raw.mode : undefined;
    const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : undefined);
    const round = int(raw.round, 1000);
    const maxRounds = int(raw.maxRounds, 1000);
    const askedAt = bounded(raw.askedAt, 40);
    const expiresAt = bounded(raw.expiresAt, 40);
    const rows = isRecord(raw.grid) ? int(raw.grid.rows, 20) : undefined;
    const cols = isRecord(raw.grid) ? int(raw.grid.cols, 20) : undefined;
    const state = oneOf(["waiting", "sent", "solved", "failed", "expired"] as const, raw.state);
    return {
      manifest,
      ...(image ? { image } : {}),
      ...(instruction ? { instruction } : {}),
      ...(site ? { site } : {}),
      ...(mode ? { mode } : {}),
      ...(round ? { round } : {}),
      ...(maxRounds ? { maxRounds } : {}),
      ...(askedAt ? { askedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(rows && cols ? { grid: { rows, cols } } : {}),
      ...(state ? { state } : {}),
    };
  },
};

const KINDS = Object.keys(CONTENT_PARSERS) as ArtifactKind[];

/**
 * An artifact's content as a loader hands it over — from the ref itself or
 * from another system. Null when it is not what the kind's viewer draws.
 */
export function parseArtifactContent<K extends ArtifactKind>(kind: K, raw: unknown): ArtifactContents[K] | null {
  return isRecord(raw) ? CONTENT_PARSERS[kind](raw) : null;
}

// ─── Versions ───────────────────────────────────────────────────────────

/**
 * Every artifact a conversation holds, oldest first: the refs messages carry,
 * and the graph artifact each graph proposal yields (`proposalGraphArtifacts`).
 * The same objects every time — the messages' own, and proposal artifacts
 * cached per proposal — so a `useShallow` selector over this only changes
 * when an artifact does.
 */
export function listArtifacts(
  messages: ReadonlyArray<{ artifacts?: ArtifactRef[]; toolCalls?: ReadonlyArray<{ output?: unknown }> }> | undefined,
): ArtifactRef[] {
  return (messages ?? []).flatMap((message) =>
    message.toolCalls?.length
      ? [...(message.artifacts ?? []), ...proposalGraphArtifacts(message.toolCalls)]
      : (message.artifacts ?? []),
  );
}

/** Kinds whose inline content is an address: what it names is the artifact, whichever turn names it. */
const ADDRESS_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>(["image", "video", "audio", "pdf", "url"]);

/**
 * Where a ref's content is read from, when every ref that reads from there
 * shows the same thing: a file on a swarm by its key (a job's `plan.md` is
 * read fresh each time, so the turn that re-reports it adds nothing), a
 * pull request by repo and number (its state is read live), a stored page
 * by its slug, an address by its URL. Null for content frozen on the
 * message, where each ref is its own snapshot.
 */
function liveSourceKey({ kind, source }: ArtifactRef): string | null {
  if (source.type === "graph") return `graph:${source.swarmId}:${source.key}`;
  const { content } = source;
  switch (kind) {
    case "pull_request": {
      const { repo, number } = content;
      return typeof repo === "string" && repo && typeof number === "number" && Number.isInteger(number)
        ? `pull_request:${repo.toLowerCase()}#${number}`
        : null;
    }
    case "html":
      return typeof content.slug === "string" && content.slug ? `html:${content.slug}` : null;
    default:
      return ADDRESS_KINDS.has(kind) && typeof content.url === "string" && content.url ? `url:${content.url}` : null;
  }
}

/**
 * What makes two refs the same artifact: where their content is read from,
 * when that is somewhere every ref shows the same thing from
 * (`liveSourceKey`), else the writer's `id`. The panel is opened by this,
 * and the chat shows one card per identity.
 */
export function artifactIdentity(artifact: ArtifactRef): string {
  return liveSourceKey(artifact) ?? `id:${artifact.id}`;
}

/** Each artifact's refs, oldest first, in the order the artifacts first appeared. */
function groupByIdentity(all: ArtifactRef[]): Map<string, ArtifactRef[]> {
  const groups = new Map<string, ArtifactRef[]>();
  for (const artifact of all) {
    const identity = artifactIdentity(artifact);
    const group = groups.get(identity);
    if (group) group.push(artifact);
    else groups.set(identity, [artifact]);
  }
  return groups;
}

/**
 * An artifact's versions, oldest first: every snapshot of inline content,
 * or only the newest ref of what is read live — its earlier refs show the
 * same thing, so there is nothing to step back to.
 */
function versionsOf(group: ArtifactRef[]): ArtifactRef[] {
  return liveSourceKey(group[0]) ? group.slice(-1) : group;
}

export interface ArtifactVersion {
  /** Zero-based place among the versions of this artifact. */
  index: number;
  count: number;
}

/**
 * The card each artifact gets: its newest ref, with where that sits among
 * the artifact's versions, so the card can say "v2". A ref not in the map
 * is an earlier report of an artifact with a newer one, and gets no card:
 * the chat shows an artifact once, under the message that reported it last.
 */
export function indexArtifactCards(all: ArtifactRef[]): Map<ArtifactRef, ArtifactVersion> {
  const cards = new Map<ArtifactRef, ArtifactVersion>();
  for (const group of groupByIdentity(all).values()) {
    const count = versionsOf(group).length;
    cards.set(group[group.length - 1], { index: count - 1, count });
  }
  return cards;
}

/**
 * The strut job that reported an artifact, when a Job row did
 * (`source.kind === "job"`, `services/strut-runs/job-turn.ts`) — read off
 * the row the ref rides on, so a viewer's action knows which job to send
 * to. Undefined for an artifact nothing but a job's row could carry.
 */
export function jobIdOfArtifact(
  messages: ReadonlyArray<{ artifacts?: ArtifactRef[]; source?: { kind: string; jobId?: string } }> | undefined,
  artifact: ArtifactRef,
): string | undefined {
  for (const message of messages ?? []) {
    // A job's turn, or a new version of its claims card made from the card (`job_claims`).
    if ((message.source?.kind === "job" || message.source?.kind === "job_claims") && message.artifacts?.includes(artifact)) return message.source.jobId;
  }
  return undefined;
}

/** The newest ref of each artifact, in the order the artifacts first appeared. */
export function latestArtifacts(all: ArtifactRef[]): ArtifactRef[] {
  return Array.from(groupByIdentity(all).values(), (group) => group[group.length - 1]);
}

export interface ResolvedArtifactPanel {
  artifact: ArtifactRef;
  /** Every version of the open artifact, oldest first. */
  versions: ArtifactRef[];
  index: number;
}

/** What the panel shows — the chat's artifact, else the live one it was opened on — or null when nothing is open or neither is there. */
export function resolveArtifactPanel(
  all: ArtifactRef[],
  panel: ArtifactPanelState | null,
): ResolvedArtifactPanel | null {
  if (!panel?.identity) return null;
  const group = all.filter((artifact) => artifactIdentity(artifact) === panel.identity);
  if (group.length === 0) {
    const { live } = panel;
    return live && artifactIdentity(live) === panel.identity ? { artifact: live, versions: [live], index: 0 } : null;
  }
  const versions = versionsOf(group);
  const index = Math.min(panel.version ?? versions.length - 1, versions.length - 1);
  return { artifact: versions[index], versions, index };
}
