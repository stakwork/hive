/**
 * A reply to Jamie's proposal post as a decision on the proposal
 * (`/api/tribes/messages`, `docs/plans/jamie-in-tribes.md`, "A proposal"):
 * which proposal a reply is about, read from the conversation's rows, and
 * whether its words decide it. Pure.
 */

import { parseStrutProposalStatus, strutProposalCardOf, type StrutProposalStatus } from "@/lib/strut-orchestrator";

export type ProposalAction = "accept" | "reject";

/** Words that decide any proposal, after its card's own. */
const ACCEPT_WORDS = new Set(["accept", "approve", "yes", "ok"]);
const REJECT_WORDS = new Set(["reject", "decline", "no"]);

/** Words as compared: one line, lower case, straight apostrophes, no closing `.` or `!`. */
const plain = (s: string): string =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "")
    .trim()
    .toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The decision a reply's text is, or null: the card's own button words
 * first (what Peel sends), then a few plain ones, and nothing else in the
 * text but a leading `@jamie` (the daemon's alias, or a tribe's
 * `@jamie_2`).
 */
export function decisionOfText(
  text: string,
  opts: { actions?: { accept: string; reject: string } | null; alias?: string } = {},
): ProposalAction | null {
  const alias = escapeRe(opts.alias?.trim() || "Jamie");
  const words = plain(text.replace(new RegExp(`^\\s*@${alias}(?:_\\d+)?(?=[\\s,:]|$)[,:]?`, "i"), ""));
  if (!words) return null;
  if (opts.actions && words === plain(opts.actions.accept)) return "accept";
  if (opts.actions && words === plain(opts.actions.reject)) return "reject";
  if (ACCEPT_WORDS.has(words)) return "accept";
  if (REJECT_WORDS.has(words)) return "reject";
  return null;
}

/** A proposal Jamie posted, as a decision needs it. */
export interface PostedProposal {
  /** The proposal row's id in the conversation. */
  rowId: string;
  /** The proposing turn's `StrutRun` id. */
  runId: string;
  proposalId: string;
  title: string;
  /** The card's button words, when strut sent a card hive reads. */
  actions: { accept: string; reject: string } | null;
}

type Source = {
  kind?: unknown;
  runId?: unknown;
  proposalId?: unknown;
  title?: unknown;
  status?: unknown;
  card?: unknown;
};
type Row = { id?: unknown; source?: Source | null };

const asRow = (raw: unknown): Row => (raw && typeof raw === "object" ? (raw as Row) : {});

function postedOf(row: Row): PostedProposal | null {
  const s = row.source;
  if (s?.kind !== "proposal" || typeof row.id !== "string") return null;
  if (typeof s.runId !== "string" || !s.runId || typeof s.proposalId !== "string" || !s.proposalId) return null;
  return {
    rowId: row.id,
    runId: s.runId,
    proposalId: s.proposalId,
    title: typeof s.title === "string" ? s.title : "",
    actions: strutProposalCardOf(s.card)?.actions ?? null,
  };
}

/** The proposal a post's row is, or null when the row is not a proposal's. */
export function proposalOfRow(rows: unknown[], rowId: string): PostedProposal | null {
  const row = rows.map(asRow).find((r) => r.id === rowId);
  return row ? postedOf(row) : null;
}

/** A proposal's status as the conversation last saw it: its newest decision row, else the status it came with. */
function statusIn(rows: Row[], proposal: PostedProposal): StrutProposalStatus {
  let status = parseStrutProposalStatus(rows.find((r) => r.id === proposal.rowId)?.source?.status);
  for (const r of rows) {
    if (r.source?.kind === "proposal_result" && r.source.proposalId === proposal.proposalId) {
      status = parseStrutProposalStatus(r.source.status);
    }
  }
  return status;
}

/**
 * For a reply that names no post (a daemon that sends the conversation
 * alone): the one proposal still open — pending, or failed and so open to
 * another accept — from the conversation's newest turn. Null when a newer
 * turn came after it, or that turn left none open or more than one: the
 * reply is then not taken for a decision.
 */
export function lastOpenProposal(raw: unknown[]): PostedProposal | null {
  const rows = raw.map(asRow);
  const newest = [...rows]
    .reverse()
    .find((r) => r.source?.kind === "orchestrator" && typeof r.source.runId === "string");
  if (!newest) return null;
  const open = rows
    .map(postedOf)
    .filter((p): p is PostedProposal => p !== null && p.runId === newest.source!.runId)
    .filter((p) => ["pending", "failed"].includes(statusIn(rows, p)));
  return open.length === 1 ? open[0] : null;
}

/** Whether the conversation holds a decision row saying the proposal is at `status`. */
export function hasDecisionRow(raw: unknown[], proposalId: string, status: StrutProposalStatus): boolean {
  return raw
    .map(asRow)
    .some(
      (r) => r.source?.kind === "proposal_result" && r.source.proposalId === proposalId && r.source.status === status,
    );
}
