/**
 * Shared ProposedFix before/after snapshot fixtures.
 *
 * The generic snapshot (`target_type` / `target_name` / `target_version` /
 * `target_ref` / `old_value` / `new_value`) is written by jarvis-backend
 * (migration `105_proposed_fix_target_snapshot`) and read by three Hive
 * surfaces under USE_MOCKS:
 *
 *  1. `recursion-fixture.ts` — the fix-chain route's scenario builders (the
 *     activity rail) spread `FIX_SNAPSHOT_SHAPES` onto a subset of their
 *     seeded ProposedFix nodes.
 *  2. The `proposed-fixes` route's inline mock branch.
 *  3. `fetchFixSnapshots` (the run-report server helper) mock branch.
 *
 * One module feeds all three so the shapes cannot drift. Every parser state
 * is represented: create, edit (both the `docs` and `documentation` body
 * keys), unparseable envelope, valid-JSON-with-no-body-key, a `prompt`
 * target, the legacy `fix_type` fallback, a rejected fix carrying a good
 * snapshot, a snapshot with no `target_ref` (live-node link suppressed), and
 * legacy fixes with no snapshot at all.
 */

import type { FixSnapshotEntry } from "@/types/legal";

/** The raw snapshot node properties, exactly as jarvis-backend writes them. */
export interface FixSnapshotShape {
  target_type?: string;
  fix_type?: string;
  target_name?: string;
  target_version?: string;
  target_ref?: string;
  old_value?: string;
  new_value?: string;
}

const CONCEPT_DOC_BEFORE =
  "Consequential damages are excluded from recovery under the limitation clause.\n" +
  "The exclusion applies to both parties symmetrically.";

const CONCEPT_DOC_AFTER =
  "Consequential damages are excluded from recovery under the limitation clause,\n" +
  "unless the breach involves gross negligence or willful misconduct.\n" +
  "The exclusion applies to both parties symmetrically.";

const PROMPT_TEXT_BEFORE =
  "Cite every case you rely on.\nUse the short-form citation on repeat mentions.";

const PROMPT_TEXT_AFTER =
  "Cite every case you rely on with full reporter and circuit information.\n" +
  "Use the short-form citation on repeat mentions.";

/**
 * Named snapshot shapes, keyed by the parser state / body variant they pin.
 * Spread these onto ProposedFix node `properties` (recursion fixture) or onto
 * projected `ProposedFix` entries (route / helper mocks).
 */
export const FIX_SNAPSHOT_SHAPES = {
  /** Create: no old_value at all, body under `documentation`. */
  conceptCreate: {
    target_type: "concept",
    target_name: "Indemnification Carve-outs",
    target_version: "1",
    target_ref: "mock-concept-indemnification-001",
    new_value: JSON.stringify({
      documentation:
        "Indemnification obligations survive termination for claims arising before the termination date.",
    }),
  },
  /** Edit with the body under the live `docs` key. */
  conceptEditDocs: {
    target_type: "concept",
    target_name: "Limitation of Liability",
    target_version: "3",
    target_ref: "mock-concept-liability-001",
    old_value: JSON.stringify({ docs: CONCEPT_DOC_BEFORE }),
    new_value: JSON.stringify({ docs: CONCEPT_DOC_AFTER }),
  },
  /** Edit with the body under the schema-canonical `documentation` key. */
  conceptEditDocumentation: {
    target_type: "concept",
    target_name: "Termination for Convenience",
    target_version: "2",
    target_ref: "mock-concept-termination-001",
    old_value: JSON.stringify({
      documentation: "Either party may terminate on 30 days' written notice.",
    }),
    new_value: JSON.stringify({
      documentation:
        "Either party may terminate on 30 days' written notice.\nTermination fees are capped at one month of charges.",
    }),
  },
  /** Unparseable new_value — a truncated JSON envelope. */
  conceptUnparseable: {
    target_type: "concept",
    target_name: "Governing Law",
    target_version: "4",
    target_ref: "mock-concept-governing-law-001",
    old_value: JSON.stringify({ docs: "Delaware law governs this agreement." }),
    new_value: '{"documentation": "Delaware law governs this agr',
  },
  /** Valid JSON on both sides but no recognizable body key → empty, not unparseable. */
  conceptNoBodyKey: {
    target_type: "concept",
    target_name: "Assignment Restrictions",
    target_version: "1",
    target_ref: "mock-concept-assignment-001",
    old_value: JSON.stringify({ revision: 3, tags: ["contracts"] }),
    new_value: JSON.stringify({ revision: 4, tags: ["contracts", "assignment"] }),
  },
  /** Prompt target — body under `text`. */
  promptEdit: {
    target_type: "prompt",
    target_name: "citation_verifier_v2",
    target_version: "v2.1",
    target_ref: "mock-prompt-citation-verifier-001",
    old_value: JSON.stringify({ text: PROMPT_TEXT_BEFORE }),
    new_value: JSON.stringify({ text: PROMPT_TEXT_AFTER }),
  },
  /** No target_type — the documented legacy `fix_type` fallback resolves the kind. */
  legacyFixType: {
    fix_type: "concept",
    target_name: "Force Majeure",
    target_version: "2",
    target_ref: "mock-concept-force-majeure-001",
    old_value: JSON.stringify({ docs: "Force majeure excuses performance during the event." }),
    new_value: JSON.stringify({
      docs: "Force majeure excuses performance during the event.\nNotice must be given within 10 business days.",
    }),
  },
  /** Good edit snapshot with NO target_ref — the live-node link must be suppressed. */
  conceptEditNoRef: {
    target_type: "concept",
    target_name: "Notice Requirements",
    target_version: "1",
    old_value: JSON.stringify({ docs: "Notices must be in writing." }),
    new_value: JSON.stringify({ docs: "Notices must be in writing and sent by certified mail or email." }),
  },
} as const satisfies Record<string, FixSnapshotShape>;

/**
 * Live-graph nodes for the snapshot `target_ref`s above, served by the mock
 * Jarvis `/v2/nodes/[ref_id]` endpoint so the reader's "open live node"
 * click-through resolves in mock mode. The bodies are DELIBERATELY diverged
 * from the snapshots' `new_value` — the loop keeps mutating concepts, and
 * showing snapshot-at-fix-time vs. current state side by side is the whole
 * point of the affordance. Concept bodies intentionally use the
 * schema-canonical `documentation` key to exercise NodePeekBody's handling
 * of it (`docs` remains covered by other mock nodes).
 */
export const MOCK_LIVE_TARGET_NODES: Record<
  string,
  { ref_id: string; node_type: string; properties: Record<string, unknown> }
> = {
  "mock-concept-liability-001": {
    ref_id: "mock-concept-liability-001",
    node_type: "Concept",
    properties: {
      name: "Limitation of Liability",
      version: 5,
      documentation:
        CONCEPT_DOC_AFTER +
        "\nDirect damages remain capped at twelve months of fees (added after this fix by a later loop iteration).",
    },
  },
  "mock-concept-indemnification-001": {
    ref_id: "mock-concept-indemnification-001",
    node_type: "Concept",
    properties: {
      name: "Indemnification Carve-outs",
      version: 2,
      documentation:
        "Indemnification obligations survive termination for claims arising before the termination date.\nCarve-outs do not extend to gross negligence (added after this fix by a later loop iteration).",
    },
  },
  "mock-concept-termination-001": {
    ref_id: "mock-concept-termination-001",
    node_type: "Concept",
    properties: {
      name: "Termination for Convenience",
      version: 3,
      documentation:
        "Either party may terminate on 30 days' written notice.\nTermination fees are capped at one month of charges.",
    },
  },
  "mock-concept-governing-law-001": {
    ref_id: "mock-concept-governing-law-001",
    node_type: "Concept",
    properties: {
      name: "Governing Law",
      version: 4,
      documentation: "Delaware law governs this agreement.",
    },
  },
  "mock-concept-assignment-001": {
    ref_id: "mock-concept-assignment-001",
    node_type: "Concept",
    properties: {
      name: "Assignment Restrictions",
      version: 4,
      documentation: "Assignment requires prior written consent, not to be unreasonably withheld.",
    },
  },
  "mock-concept-force-majeure-001": {
    ref_id: "mock-concept-force-majeure-001",
    node_type: "Concept",
    properties: {
      name: "Force Majeure",
      version: 3,
      documentation:
        "Force majeure excuses performance during the event.\nNotice must be given within 10 business days.",
    },
  },
  "mock-prompt-citation-verifier-001": {
    ref_id: "mock-prompt-citation-verifier-001",
    node_type: "Prompt",
    properties: {
      name: "citation_verifier_v2",
      version: "v2.3",
      text:
        PROMPT_TEXT_AFTER +
        "\nAlways include pin cites for quoted passages (added after this fix by a later loop iteration).",
    },
  },
};

/**
 * Full projected mock ProposedFix entries for the proposed-fixes route and the
 * run-report server helper. The first two entries preserve the route's
 * long-standing mock pair (pending / improved, project_id 57419) so existing
 * consumers and tests keep their anchors; the rest cover every snapshot shape,
 * one rejected-with-good-snapshot entry, and legacy no-snapshot entries.
 *
 * The route filters `status === "rejected"` before responding (its historical
 * contract); the helper deliberately does not.
 */
export function buildSnapshotMockFixes(): FixSnapshotEntry[] {
  return [
    {
      ref_id: "mock-fix-1",
      criterion_id: "criterion-1",
      criterion_title: "Citation Accuracy",
      prompt_name: "citation_verifier_v2",
      prompt_id: "prompt-abc",
      prompt_version_id: "v2.1",
      new_prompt_version_id: "v2.2",
      failing_value: "The court held in Smith v. Jones (2018)...",
      passing_value: "The court held in Smith v. Jones, 123 F.3d 456 (9th Cir. 2018)...",
      delta: "Added full citation format with reporter and circuit information",
      reasoning:
        "The original prompt did not instruct the model to include reporter citations, causing incomplete legal references.",
      status: "pending",
      rerun_status: "pending",
      before_score: undefined,
      after_score: undefined,
      score_delta: undefined,
      rerun_run_id: undefined,
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.promptEdit,
    },
    {
      ref_id: "mock-fix-2",
      criterion_id: "criterion-2",
      criterion_title: "Argument Completeness",
      prompt_name: "argument_builder_v3",
      prompt_id: "prompt-def",
      prompt_version_id: "v3.0",
      new_prompt_version_id: "v3.1",
      failing_value: "50",
      passing_value: "54",
      delta: "Enhanced prompt to require explicit counter-argument analysis",
      reasoning:
        "The model missed the counter-argument section. New version explicitly instructs inclusion.",
      status: "pending",
      rerun_status: "improved",
      before_score: "50",
      after_score: "54",
      score_delta: "+4",
      rerun_run_id: "rerun-run-mock-1",
      project_id: 57419,
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
    },
    {
      ref_id: "mock-fix-concept-create",
      criterion_id: "criterion-3",
      criterion_title: "Indemnification Coverage",
      status: "accepted",
      eval_status: "accepted",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptCreate,
    },
    {
      ref_id: "mock-fix-concept-documentation",
      criterion_id: "criterion-4",
      criterion_title: "Termination Terms",
      status: "accepted",
      eval_status: "accepted",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocumentation,
    },
    {
      ref_id: "mock-fix-unparseable",
      criterion_id: "criterion-5",
      criterion_title: "Governing Law Precision",
      status: "pending",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptUnparseable,
    },
    {
      ref_id: "mock-fix-no-body-key",
      criterion_id: "criterion-6",
      criterion_title: "Assignment Language",
      status: "pending",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptNoBodyKey,
    },
    {
      ref_id: "mock-fix-legacy-fix-type",
      criterion_id: "criterion-7",
      criterion_title: "Force Majeure Notice",
      status: "accepted",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.legacyFixType,
    },
    {
      // Rejected fix carrying a good snapshot — one of the most informative
      // diffs a reviewer can see. The route's rejected filter drops it; the
      // helper keeps it and the new section badges it rejected.
      ref_id: "mock-fix-rejected-snapshot",
      criterion_id: "criterion-8",
      criterion_title: "Liability Symmetry",
      status: "rejected",
      eval_status: "rejected",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
      target_name: "Limitation of Liability (rejected variant)",
    },
    {
      ref_id: "mock-fix-no-target-ref",
      criterion_id: "criterion-9",
      criterion_title: "Notice Formalities",
      status: "pending",
      project_id: null,
      ...FIX_SNAPSHOT_SHAPES.conceptEditNoRef,
    },
    // ── Legacy fixes: no snapshot fields at all → explicit empty state ──────
    {
      ref_id: "mock-fix-legacy-1",
      criterion_id: "criterion-10",
      criterion_title: "Warranty Scope",
      prompt_name: "warranty_checker_v1",
      status: "accepted",
      project_id: null,
    },
    {
      ref_id: "mock-fix-legacy-2",
      criterion_id: "criterion-11",
      criterion_title: "Severability Handling",
      prompt_name: "severability_v1",
      status: "pending",
      project_id: null,
    },
  ];
}
