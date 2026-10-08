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
}

/** What a viewer draws, for each kind. */
export interface ArtifactContents {
  markdown: { text: string };
  /** A stored HTML page, by its slug in the conversation's org — never the markup itself. */
  html: {
    slug: string;
    /** Changes when the page is rewritten, so an open frame refetches it. */
    updatedAt?: string;
  };
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
    /** The description, as markdown. */
    body?: string;
    checks?: PullRequestCheck[];
    /** The files changed, when the producer has them. */
    diffs?: ActionResult[];
    /**
     * The Strut job that opened this PR — carried so the live-read hook can
     * call the pull-request status route without a separate lookup.
     * Set by `job-turn.ts`; absent on refs that pre-date this field.
     */
    jobId?: string;
    swarmId?: string;
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
   */
  graph: { workspace: string; focus?: string; changes?: GraphChange[]; proposal?: string };
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
}

/** The artifact on the panel, by `artifactIdentity`. `version` is its place among that artifact's versions; null follows the newest. */
export interface ArtifactPanelState {
  identity: string;
  version: number | null;
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
  return status && { name: raw.name, status };
}

/** Content whose only required part is an address. */
const address = (raw: Record<string, unknown>): { url: string } | null =>
  typeof raw.url === "string" && raw.url.length > 0 ? { url: raw.url } : null;

const text = (raw: Record<string, unknown>): { text: string } | null =>
  typeof raw.text === "string" ? { text: raw.text } : null;

const CONTENT_PARSERS: { [K in ArtifactKind]: (raw: Record<string, unknown>) => ArtifactContents[K] | null } = {
  markdown: text,
  log: text,
  audio: address,
  pdf: address,
  url: address,
  html: (raw) => {
    const slug = bounded(raw.slug, MAX_ID_LENGTH);
    return slug ? { slug, updatedAt: optional(raw.updatedAt) } : null;
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
      body: optional(raw.body),
      checks,
      diffs,
      // Live-read identifiers — optional, set by job-turn.ts.
      jobId: bounded(raw.jobId, MAX_ID_LENGTH) ?? undefined,
      swarmId: bounded(raw.swarmId, MAX_ID_LENGTH) ?? undefined,
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
        }
      : null;
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

/** What the panel shows, or null when nothing is open or the conversation no longer holds it. */
export function resolveArtifactPanel(
  all: ArtifactRef[],
  panel: ArtifactPanelState | null,
): ResolvedArtifactPanel | null {
  if (!panel) return null;
  const group = all.filter((artifact) => artifactIdentity(artifact) === panel.identity);
  if (group.length === 0) return null;
  const versions = versionsOf(group);
  const index = Math.min(panel.version ?? versions.length - 1, versions.length - 1);
  return { artifact: versions[index], versions, index };
}
