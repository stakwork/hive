/**
 * Mutable in-memory proposal fixtures for mock stakgraph endpoints.
 *
 * These are module-level so mutations (accept/reject) persist across requests
 * within a single dev-server lifetime, making the already-decided 409 path
 * reachable without an external database.
 *
 * Concept IDs reference the same ids used in the concepts/[id] mock so that
 * stale_base drift comparisons work against real mock documentation values.
 *
 * Both `mockProposals` and `mockConceptDocs` are produced by single factory
 * functions and restored together by `resetMockProposals()` — accept mutates
 * the docs map (mirroring the real swarm applying the change), so the two
 * must reset as a unit or tests become order-dependent.
 */

import type {
  ConceptProposal,
  ProposalAction,
  ProposalStatus,
} from "@/types/concept-proposals";

// Canonical proposal types live in src/types/concept-proposals.ts (shared
// with the /learn review UI). Re-exported here so the mock routes and their
// tests keep importing from the fixtures module.
export type { ProposalAction, ProposalStatus };
export type MockProposal = ConceptProposal;

/**
 * Current documentation for mock concepts (mirrors the concepts/[id] mock).
 * Used to detect stale_base drift on accept; accept also writes applied
 * changes back into this map so the mock world stays consistent.
 */
function initialConceptDocs(): Record<string, string> {
  return {
    "stakwork/hive/auth": "Handles JWT and OAuth flows for user authentication.",
    "stakwork/hive/tasks":
      "Core task CRUD with dual status system (user vs workflow).",
    "stakwork/hive/janitors":
      "Automated code quality analysis and PR monitoring janitors.",
    "stakwork/hive/workspace":
      "Multi-tenant workspace with role-based access control (RBAC).",
    "stakwork/hive/swarm":
      "Pod and swarm lifecycle management for AI agent workloads.",
  };
}

function initialProposals(): MockProposal[] {
  return [
    {
      id: "proposal-create-1",
      action: "create",
      status: "pending",
      name: "Encryption Service",
      description: "Field-level encryption for sensitive data",
      documentation:
        "AES-256-GCM field-level encryption for all sensitive database fields. Keys are rotated via `npm run rotate-keys`.",
      rationale:
        "PR #142 introduced FieldEncryptionService; capturing it as a standalone concept.",
      source: "https://github.com/stakwork/hive/pull/142",
      prNumbers: [142],
      sessionIds: [],
      createdAt: "2025-08-05T10:00:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "proposal-update-1",
      action: "update",
      status: "pending",
      conceptId: "stakwork/hive/tasks",
      documentation:
        "Core task CRUD with dual status system (user vs workflow). Tasks now support blocking dependencies tracked via taskDependencies join table.",
      baseDocs: "Core task CRUD with dual status system (user vs workflow).",
      rationale: "PR #201 added task dependency tracking.",
      source: "https://github.com/stakwork/hive/pull/201",
      prNumbers: [201],
      sessionIds: [],
      createdAt: "2025-08-06T14:30:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "proposal-delete-1",
      action: "delete",
      status: "pending",
      conceptId: "stakwork/hive/janitors",
      baseDocs: "Automated code quality analysis and PR monitoring janitors.",
      rationale:
        "Janitor functionality is now fully subsumed by the Swarm Orchestration concept.",
      source: "https://github.com/stakwork/hive/pull/210",
      prNumbers: [210],
      sessionIds: [],
      createdAt: "2025-08-07T09:15:00.000Z",
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
      // baseDocs snapshots the SURVIVOR (swarm) — the stale_base check runs
      // against the surviving concept, matching the real swarm contract.
      baseDocs: "Pod and swarm lifecycle management for AI agent workloads.",
      absorbedDocs:
        "Automated code quality analysis and PR monitoring janitors.",
      rationale:
        "Janitor concepts are logically part of swarm orchestration; merging avoids duplication.",
      source: "https://github.com/stakwork/hive/pull/215",
      prNumbers: [215],
      sessionIds: [],
      createdAt: "2025-08-08T16:45:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "proposal-stale-1",
      action: "update",
      status: "pending",
      conceptId: "stakwork/hive/auth",
      documentation:
        "Handles JWT, OAuth, and SAML flows for user authentication with MFA support.",
      // Deliberately does NOT match the auth entry in initialConceptDocs so
      // the stale_base path triggers unless force=true is sent.
      baseDocs: "Handles JWT flows for user authentication. (outdated snapshot)",
      rationale: "PR #300 added SAML and MFA; baseDocs is intentionally stale.",
      source: "https://github.com/stakwork/hive/pull/300",
      prNumbers: [300],
      sessionIds: [],
      createdAt: "2025-08-09T11:20:00.000Z",
      repo: "stakwork/hive",
    },
  ];
}

/** Mutable module-level state — `let` bindings so reset can reassign. */
export let mockProposals: MockProposal[] = initialProposals();
export let mockConceptDocs: Record<string, string> = initialConceptDocs();

/** Reset all mock proposal state — used by tests to restore pristine state. */
export function resetMockProposals(): void {
  mockProposals = initialProposals();
  mockConceptDocs = initialConceptDocs();
}

export const VALID_STATUSES: ProposalStatus[] = ["pending", "accepted", "rejected"];
