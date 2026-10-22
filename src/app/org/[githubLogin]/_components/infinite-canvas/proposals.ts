/**
 * Strut's pending graph proposals, drawn where they belong on the canvas as
 * pencil cards: a new initiative on the desk, a new milestone, feature,
 * story or requirement under the card it is linked to, an edit on the card
 * it changes. Each is a strut proposal (`StrutProposalRecord`), decided with
 * Accept / Reject through the same decide route as the chat's card. Pure:
 * no React.
 */

import type { StrutProposalRecord } from "@/lib/strut-orchestrator";
import { type Board, byId, type NodeType, type PlanNode, textField } from "./board";

/** A pending proposal as the canvas holds it: its record and the turn whose reads it is scoped by. */
export interface PendingProposal {
  runId: string;
  record: StrutProposalRecord;
}

/** What a pencil card needs to show and decide its proposal. */
export interface Pencil {
  proposalId: string;
  runId: string;
  /** Said from the proposal's content: "New initiative: Billing". */
  title: string;
  rationale?: string;
}

/** The plan's graph labels, as the canvas's card kinds. */
const KIND: Record<string, NodeType> = {
  HiveInitiative: "initiative",
  Brief: "brief",
  HiveMilestone: "milestone",
  InitiativeFeature: "feature",
  UserStory: "story",
  Requirement: "requirement",
};

const WORD: Record<NodeType, string> = {
  initiative: "initiative",
  brief: "brief",
  milestone: "milestone",
  feature: "feature",
  story: "user story",
  requirement: "requirement",
  question: "question",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** A new card's words: its name, else its text. */
const wordsOf = (data: Record<string, unknown>) => str(data.name) ?? str(data.text) ?? str(data.title) ?? "Untitled";

/** A proposed new card, waiting under its parent (or, for an initiative, on the desk). */
interface Made {
  type: NodeType;
  data: Record<string, unknown>;
  parent?: string;
}

/** The new cards a create step proposes: a lone node, or nodes linked from a card already on the board. */
function madeBy(record: StrutProposalRecord, board: Board): Made[] {
  const input = isRecord(record.input) ? record.input : {};
  const created = (type: unknown, data: unknown, parent?: string): Made[] => {
    const kind = typeof type === "string" ? KIND[type] : undefined;
    return kind ? [{ type: kind, data: isRecord(data) ? data : {}, ...(parent ? { parent } : {}) }] : [];
  };
  // A triplet makes a card under its source when the source is a card here and the target is new.
  const fromTriplet = (t: Record<string, unknown>): Made[] => {
    const source = str(t.source_ref_id);
    if (!source || !byId(board, source) || str(t.target_ref_id)) return [];
    return created(t.target_type, t.target_data, source);
  };
  switch (record.step) {
    case "graph/create-node":
      return created(input.node_type, input.node_data);
    case "graph/create-triplet":
      return fromTriplet(input);
    case "graph/create-batch-triplet":
      return Array.isArray(input.triplets) ? input.triplets.filter(isRecord).flatMap(fromTriplet) : [];
    default:
      return [];
  }
}

/** A proposal's title, from what it does: "New initiative: Billing", "Add milestone "Beta" to Billing". */
export function proposalTitle(record: StrutProposalRecord, board: Board): string {
  const input = isRecord(record.input) ? record.input : {};
  if (record.step === "graph/edit-node") {
    const n = byId(board, str(input.ref_id) ?? "");
    return n ? `Edit ${WORD[n.type]} "${n.name}"` : record.title;
  }
  const made = madeBy(record, board);
  if (!made.length) return record.title;
  const [first] = made;
  if (made.length > 1) return `Add ${made.length} cards to ${byId(board, first.parent ?? "")?.name ?? "the plan"}`;
  if (!first.parent) return `New ${WORD[first.type]}: ${wordsOf(first.data)}`;
  return `Add ${WORD[first.type]} "${wordsOf(first.data)}" to ${byId(board, first.parent)?.name ?? "the plan"}`;
}

/**
 * The board with each pending proposal drawn in: new cards as pencil cards
 * (`pencil` set; a new initiative on the desk, as the latest), an edit as the
 * changed words on its card (`pencilEdit`). A proposal that touches nothing
 * the canvas shows (another kind of node, a parent not on the board) is
 * left out. Pure.
 */
export function withProposals(board: Board, proposals: readonly PendingProposal[], now = Date.now()): Board {
  if (!proposals.length) return board;
  const nodes = [...board.nodes];
  const edits = new Map<string, PlanNode["pencilEdit"]>();
  for (const { runId, record } of proposals) {
    const pencil: Pencil = {
      proposalId: record.id,
      runId,
      title: proposalTitle(record, board),
      ...(record.rationale ? { rationale: record.rationale } : {}),
    };
    const input = isRecord(record.input) ? record.input : {};
    if (record.step === "graph/edit-node") {
      const target = byId(board, str(input.ref_id) ?? "");
      const data = isRecord(input.node_data) ? input.node_data : {};
      const words = target ? str(data[textField(target.type)]) : undefined;
      if (target && words) edits.set(target.id, { ...pencil, name: words });
      continue;
    }
    madeBy(record, board).forEach((m, i) => {
      const parent = m.parent ? byId(board, m.parent) : undefined;
      if (m.type !== "initiative" && !parent) return;
      nodes.push({
        id: `pencil:${record.id}:${i}`,
        ws: parent?.ws ?? record.workspaceSlug ?? "",
        type: m.type,
        ...(parent ? { parent: parent.id } : {}),
        name: wordsOf(m.data),
        author: "strut",
        status: "proposed",
        ...(typeof m.data.sequence === "number" ? { sequence: m.data.sequence } : {}),
        // A new initiative is the latest thing on the board: it goes on the desk.
        ...(m.type === "initiative" ? { updatedAt: now } : {}),
        pencil,
      });
    });
  }
  return {
    nodes: nodes.map((n) => (edits.has(n.id) ? { ...n, pencilEdit: edits.get(n.id) } : n)),
  };
}
