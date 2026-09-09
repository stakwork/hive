/**
 * Concept change proposal types — the contract of the swarm's
 * /gitree/proposals API as proxied by /api/learnings/concepts/proposals.
 *
 * Shared by the /learn review UI, the graph-chat proposal chips, and the
 * mock stakgraph fixtures (the mocks import these so the mock world and
 * the UI can never drift apart).
 *
 * NOT the same thing as the canvas `ProposalOutput` union in
 * src/lib/proposals/types.ts — that is the older chat-metadata pipeline
 * (direct-apply on approve, no delete/merge, no stale_base handling).
 */

export type ProposalAction = "create" | "update" | "delete" | "merge";
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface ConceptProposal {
  id: string;
  action: ProposalAction;
  status: ProposalStatus;
  /** For update/delete/merge — the concept being changed or absorbed */
  conceptId?: string;
  /** For merge — the survivor concept that absorbs the deleted one */
  mergeIntoConceptId?: string;
  /** Proposed new name (create) */
  name?: string;
  /** Optional one-line description (create/update) */
  description?: string;
  /** Proposed documentation (create / update / merge result) */
  documentation?: string;
  /**
   * Docs snapshot of the concept being EDITED, captured at proposal-creation
   * time. For update/delete this is the target concept; for merge it is the
   * SURVIVING concept (mergeIntoConceptId) — the stale_base check runs against
   * the survivor.
   */
  baseDocs?: string;
  /** Docs of the absorbed concept (merge only) */
  absorbedDocs?: string;
  /** Optional parent concept id (create only) */
  parent?: string;
  /** Human-readable rationale for the proposal */
  rationale: string;
  /** Source of the proposal (e.g. PR url or tool name) */
  source: string;
  /** Related PR numbers */
  prNumbers: number[];
  /** Agent sessions that motivated this proposal */
  sessionIds?: string[];
  /** Set to the new concept id on accepted create proposals */
  createdConceptId?: string;
  /** User id that accepted/rejected this proposal */
  decidedBy?: string;
  /** Optional rejection reason */
  decisionReason?: string;
  /** ISO timestamp of the decision */
  decidedAt?: string;
  /** ISO timestamp of proposal creation */
  createdAt: string;
  /** Repository this proposal belongs to */
  repo: string;
}

/** Response shape of GET /api/learnings/concepts/proposals */
export interface ConceptProposalListResponse {
  proposals: ConceptProposal[];
  count: number;
  repo: string;
}

/**
 * Concept ids that should carry a pending-proposal marker in the UI:
 * the target concept for update/delete, and BOTH sides of a merge
 * (the absorbed concept and the survivor). Create proposals have no
 * existing concept to flag.
 */
export function derivePendingProposalConceptIds(
  proposals: ConceptProposal[],
): Set<string> {
  const ids = new Set<string>();
  for (const proposal of proposals) {
    if (proposal.status !== "pending") continue;
    if (proposal.conceptId) ids.add(proposal.conceptId);
    if (proposal.action === "merge" && proposal.mergeIntoConceptId) {
      ids.add(proposal.mergeIntoConceptId);
    }
  }
  return ids;
}

/** Short human label for a proposal row (sidebar list, chips). */
export function conceptProposalLabel(proposal: ConceptProposal): string {
  switch (proposal.action) {
    case "create":
      return proposal.name ?? "New concept";
    case "merge":
      return `${proposal.conceptId ?? "?"} → ${proposal.mergeIntoConceptId ?? "?"}`;
    default:
      return proposal.conceptId ?? proposal.id;
  }
}

/** Closed set of per-id outcomes from POST /api/learnings/concepts/proposals/bulk. */
export type BulkProposalDecisionCode =
  | "stale_base"
  | "already_decided"
  | "not_found"
  | "not_attempted"
  | "upstream_error";

export interface BulkProposalDecisionResult {
  id: string;
  ok: boolean;
  code?: BulkProposalDecisionCode;
  message?: string;
  createdConceptId?: string;
}

export interface BulkProposalDecisionResponse {
  results: BulkProposalDecisionResult[];
}

/** Maximum number of proposals in a single bulk decision request. */
export const BULK_PROPOSAL_DECISION_CAP = 25;

/** Reviewer-facing copy for each closed bulk-decision failure code. */
export const BULK_PROPOSAL_FAILURE_MESSAGE: Record<BulkProposalDecisionCode, string> = {
  stale_base: "Needs re-review",
  already_decided: "Already decided",
  not_found: "No longer available",
  not_attempted: "Not attempted — try again",
  upstream_error: "Something went wrong — try again",
};
