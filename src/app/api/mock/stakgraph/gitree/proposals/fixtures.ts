/**
 * Mutable in-memory proposal fixtures for mock stakgraph endpoints.
 *
 * These are module-level so mutations (accept/reject) persist across requests
 * within a single dev-server lifetime, making the already-decided 409 path
 * reachable without an external database.
 *
 * Concept IDs reference the same ids used in the concepts/[id] mock so that
 * stale_base drift comparisons work against real mock documentation values.
 */

export type ProposalAction = "create" | "update" | "delete" | "merge";
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface MockProposal {
  id: string;
  action: ProposalAction;
  status: ProposalStatus;
  /** For update/delete/merge — the concept being changed or absorbed */
  conceptId?: string;
  /** For merge — the survivor concept that absorbs the deleted one */
  mergeIntoConceptId?: string;
  /** Proposed new name (create) */
  name?: string;
  /** Proposed documentation (create / update / merge result) */
  documentation?: string;
  /** The documentation at proposal-creation time (update/delete/merge base) */
  baseDocs?: string;
  /** Docs of the absorbed concept (merge only) */
  absorbedDocs?: string;
  /** Human-readable rationale for the proposal */
  rationale: string;
  /** Source of the proposal (e.g. PR url or tool name) */
  source: string;
  /** Related PR numbers */
  prNumbers: number[];
  /** Set to the new concept id on accepted create proposals */
  createdConceptId?: string;
  /** User id that accepted/rejected this proposal */
  decidedBy?: string;
  /** Optional rejection reason */
  decisionReason?: string;
  /** ISO timestamp of the decision */
  decidedAt?: string;
  /** Repository this proposal belongs to */
  repo: string;
}

/**
 * The documentation stored in the concepts/[id] mock for "stakwork/hive/auth".
 * The stale_base fixture deliberately has a *different* baseDocs so accepting
 * without force=true triggers a 409 { code: "stale_base" }.
 */
const AUTH_CURRENT_DOCS = "Handles JWT and OAuth flows for user authentication.";

/**
 * Mutable module-level proposal list.
 * Exported as a `let` binding so tests can reset it via the helper below.
 */
export let mockProposals: MockProposal[] = [
  {
    id: "proposal-create-1",
    action: "create",
    status: "pending",
    name: "Encryption Service",
    documentation:
      "AES-256-GCM field-level encryption for all sensitive database fields. Keys are rotated via `npm run rotate-keys`.",
    baseDocs: undefined,
    rationale:
      "PR #142 introduced FieldEncryptionService; capturing it as a standalone concept.",
    source: "https://github.com/stakwork/hive/pull/142",
    prNumbers: [142],
    repo: "stakwork/hive",
  },
  {
    id: "proposal-update-1",
    action: "update",
    status: "pending",
    conceptId: "stakwork/hive/tasks",
    documentation:
      "Core task CRUD with dual status system (user vs workflow). Tasks now support blocking dependencies tracked via taskDependencies join table.",
    baseDocs:
      "Core task CRUD with dual status system (user vs workflow).",
    rationale: "PR #201 added task dependency tracking.",
    source: "https://github.com/stakwork/hive/pull/201",
    prNumbers: [201],
    repo: "stakwork/hive",
  },
  {
    id: "proposal-delete-1",
    action: "delete",
    status: "pending",
    conceptId: "stakwork/hive/janitors",
    baseDocs:
      "Automated code quality analysis and PR monitoring janitors.",
    rationale:
      "Janitor functionality is now fully subsumed by the Swarm Orchestration concept.",
    source: "https://github.com/stakwork/hive/pull/210",
    prNumbers: [210],
    repo: "stakwork/hive",
  },
  {
    id: "proposal-merge-1",
    action: "merge",
    status: "pending",
    /** absorbed/deleted concept */
    conceptId: "stakwork/hive/janitors",
    /** survivor concept */
    mergeIntoConceptId: "stakwork/hive/swarm",
    documentation:
      "Pod and swarm lifecycle management for AI agent workloads, including automated code quality janitors and PR monitoring.",
    /**
     * baseDocs for merge = the absorbed (janitors) concept's current docs,
     * which matches mockConceptDocs["stakwork/hive/janitors"] so the stale_base
     * check passes cleanly (no unexpected drift on the merge fixture).
     */
    baseDocs:
      "Automated code quality analysis and PR monitoring janitors.",
    absorbedDocs:
      "Automated code quality analysis and PR monitoring janitors.",
    rationale:
      "Janitor concepts are logically part of swarm orchestration; merging avoids duplication.",
    source: "https://github.com/stakwork/hive/pull/215",
    prNumbers: [215],
    repo: "stakwork/hive",
  },
  {
    id: "proposal-stale-1",
    action: "update",
    status: "pending",
    conceptId: "stakwork/hive/auth",
    documentation:
      "Handles JWT, OAuth, and SAML flows for user authentication with MFA support.",
    /**
     * Deliberately does NOT match AUTH_CURRENT_DOCS so that the stale_base
     * path triggers unless force=true is sent.
     */
    baseDocs: "Handles JWT flows for user authentication. (outdated snapshot)",
    rationale: "PR #300 added SAML and MFA; baseDocs is intentionally stale.",
    source: "https://github.com/stakwork/hive/pull/300",
    prNumbers: [300],
    repo: "stakwork/hive",
  },
];

/** Reset to the initial fixture set — used by tests to restore pristine state. */
export function resetMockProposals(): void {
  mockProposals = [
    {
      id: "proposal-create-1",
      action: "create",
      status: "pending",
      name: "Encryption Service",
      documentation:
        "AES-256-GCM field-level encryption for all sensitive database fields. Keys are rotated via `npm run rotate-keys`.",
      baseDocs: undefined,
      rationale:
        "PR #142 introduced FieldEncryptionService; capturing it as a standalone concept.",
      source: "https://github.com/stakwork/hive/pull/142",
      prNumbers: [142],
      repo: "stakwork/hive",
    },
    {
      id: "proposal-update-1",
      action: "update",
      status: "pending",
      conceptId: "stakwork/hive/tasks",
      documentation:
        "Core task CRUD with dual status system (user vs workflow). Tasks now support blocking dependencies tracked via taskDependencies join table.",
      baseDocs:
        "Core task CRUD with dual status system (user vs workflow).",
      rationale: "PR #201 added task dependency tracking.",
      source: "https://github.com/stakwork/hive/pull/201",
      prNumbers: [201],
      repo: "stakwork/hive",
    },
    {
      id: "proposal-delete-1",
      action: "delete",
      status: "pending",
      conceptId: "stakwork/hive/janitors",
      baseDocs:
        "Automated code quality analysis and PR monitoring janitors.",
      rationale:
        "Janitor functionality is now fully subsumed by the Swarm Orchestration concept.",
      source: "https://github.com/stakwork/hive/pull/210",
      prNumbers: [210],
      repo: "stakwork/hive",
    },
    {
      id: "proposal-merge-1",
      action: "merge",
      status: "pending",
      conceptId: "stakwork/hive/janitors",
      mergeIntoConceptId: "stakwork/hive/swarm",
      documentation:
        "Pod and swarm lifecycle management for AI agent workloads, including automated code quality janitors and PR monitoring.",
      baseDocs:
        "Automated code quality analysis and PR monitoring janitors.",
      absorbedDocs:
        "Automated code quality analysis and PR monitoring janitors.",
      rationale:
        "Janitor concepts are logically part of swarm orchestration; merging avoids duplication.",
      source: "https://github.com/stakwork/hive/pull/215",
      prNumbers: [215],
      repo: "stakwork/hive",
    },
    {
      id: "proposal-stale-1",
      action: "update",
      status: "pending",
      conceptId: "stakwork/hive/auth",
      documentation:
        "Handles JWT, OAuth, and SAML flows for user authentication with MFA support.",
      baseDocs: "Handles JWT flows for user authentication. (outdated snapshot)",
      rationale: "PR #300 added SAML and MFA; baseDocs is intentionally stale.",
      source: "https://github.com/stakwork/hive/pull/300",
      prNumbers: [300],
      repo: "stakwork/hive",
    },
  ];
}

/**
 * Current documentation for mock concepts (mirrors the concepts/[id] mock).
 * Used to detect stale_base drift on accept.
 */
export const mockConceptDocs: Record<string, string> = {
  "stakwork/hive/auth": AUTH_CURRENT_DOCS,
  "stakwork/hive/tasks":
    "Core task CRUD with dual status system (user vs workflow).",
  "stakwork/hive/janitors":
    "Automated code quality analysis and PR monitoring janitors.",
  "stakwork/hive/workspace":
    "Multi-tenant workspace with role-based access control (RBAC).",
  "stakwork/hive/swarm":
    "Pod and swarm lifecycle management for AI agent workloads.",
};

export const VALID_STATUSES: ProposalStatus[] = ["pending", "accepted", "rejected"];
