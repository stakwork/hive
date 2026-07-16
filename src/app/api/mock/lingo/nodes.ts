import type { LingoType } from "@/lib/constants/lingo";

export interface LingoNode {
  ref_id: string;
  node_type: string;           // "Lingo"
  name: string;
  definition?: string | null;  // promoted from properties.definition
  date_added_to_graph: number; // epoch float — replaces created_at
  lingo_type?: LingoType;
  icon_url?: string | null;
}

export interface LingoDefinition {
  ref_id: string;
  text: string;
  valid_from: string;   // ISO 8601 date
  valid_until: string | null; // null = current/active definition
}

// Seeded LingoDefinition nodes — 2 Lingo nodes × 2 chained defs each.
// Each pair has one superseded (valid_until set) and one current (valid_until = null).
export const mockLingoDefinitions: LingoDefinition[] = [
  // Pod Orchestration definitions (jargon-001)
  {
    ref_id: "jargon-def-001-v1",
    text: "The process of managing compute pods within a workspace swarm.",
    valid_from: "2026-01-01",
    valid_until: "2026-06-01",
  },
  {
    ref_id: "jargon-def-001-v2",
    text: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
    valid_from: "2026-06-01",
    valid_until: null,
  },
  // Swarm definitions (jargon-003)
  {
    ref_id: "jargon-def-003-v1",
    text: "A cluster of AI agents assigned to a workspace.",
    valid_from: "2026-01-01",
    valid_until: "2026-05-15",
  },
  {
    ref_id: "jargon-def-003-v2",
    text: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
    valid_from: "2026-05-15",
    valid_until: null,
  },
];

export const mockLingoNodes: LingoNode[] = [
  {
    ref_id: "jargon-001",
    node_type: "Lingo",
    name: "Pod Orchestration",
    definition: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
    date_added_to_graph: 1750442400,
    lingo_type: "company_jargon",
  },
  {
    ref_id: "jargon-002",
    node_type: "Lingo",
    name: "Janitor Workflow",
    definition: "An automated code quality sweep that analyses a repository for test coverage gaps, security vulnerabilities, and refactoring opportunities.",
    date_added_to_graph: 1750440600,
    lingo_type: "company_jargon",
  },
  {
    ref_id: "jargon-003",
    node_type: "Lingo",
    name: "Swarm",
    definition: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
    date_added_to_graph: 1750438800,
    lingo_type: "industry_term",
  },
  {
    ref_id: "jargon-004",
    node_type: "Lingo",
    name: "StakworkRun",
    definition: "A tracked execution of a Stakwork AI workflow, recording inputs, outputs, and status transitions for audit and debugging.",
    date_added_to_graph: 1750437000,
    lingo_type: "code_symbol",
  },
  {
    ref_id: "jargon-005",
    node_type: "Lingo",
    name: "Feature Brief",
    definition: "A structured description of a product feature including requirements, architecture notes, and linked user stories.",
    date_added_to_graph: 1750435200,
    lingo_type: "system_page",
  },
  {
    ref_id: "jargon-006",
    node_type: "Lingo",
    name: "Workspace Slug",
    definition: "A URL-safe, lowercase identifier for a workspace used in routing (e.g., /w/my-workspace). Must not contain capitals, spaces, or leading/trailing hyphens.",
    date_added_to_graph: 1750433400,
    lingo_type: "system_page",
  },
  {
    ref_id: "jargon-007",
    node_type: "Lingo",
    name: "Dual Status System",
    definition: "Tasks carry two independent status fields: `status` for user/PM work tracking and `workflowStatus` for system automation state.",
    date_added_to_graph: 1750431600,
    lingo_type: "company_jargon",
  },
  {
    ref_id: "jargon-008",
    node_type: "Lingo",
    name: "Field-Level Encryption",
    definition: "AES-256-GCM encryption applied to individual sensitive database fields (e.g., API keys, tokens) using the EncryptionService.",
    date_added_to_graph: 1750429800,
    lingo_type: "industry_term",
  },
  {
    ref_id: "jargon-009",
    node_type: "Lingo",
    name: "Jarvis",
    definition: "The graph database backend (ArcadeDB) that stores knowledge nodes and edges for a workspace swarm.",
    date_added_to_graph: 1750428000,
    lingo_type: "product_term",
  },
  {
    ref_id: "jargon-010",
    node_type: "Lingo",
    name: "IDOR Guard",
    definition: "Insecure Direct Object Reference protection ensuring that authenticated users can only access resources belonging to their authorised workspace.",
    date_added_to_graph: 1750426200,
    lingo_type: "acronym",
  },
  {
    ref_id: "jargon-011",
    node_type: "Lingo",
    name: "IntersectionObserver Sentinel",
    definition: "A zero-height div placed at the bottom of a scrollable list that, when it enters the viewport, triggers the next page fetch for infinite scroll.",
    date_added_to_graph: 1750424400,
    lingo_type: "code_symbol",
  },
  {
    ref_id: "jargon-012",
    node_type: "Lingo",
    name: "Optimistic Update",
    definition: "A UI pattern where the interface reflects the expected result of an action immediately, before the server confirms success, improving perceived responsiveness.",
    date_added_to_graph: 1750422600,
    lingo_type: "industry_term",
  },
  {
    ref_id: "jargon-013",
    node_type: "Lingo",
    name: "Breadcrumb Trail",
    definition: "A navigation aid displaying the sequence of nodes a user has traversed in the graph explorer, allowing step-back navigation.",
    date_added_to_graph: 1750420800,
    lingo_type: "system_page",
  },
  {
    ref_id: "jargon-014",
    node_type: "Lingo",
    name: "Pusher Channel",
    definition: "A real-time event channel provided by Pusher used to broadcast live updates (e.g., task status, workflow progress) to connected clients.",
    date_added_to_graph: 1750419000,
    lingo_type: "product_term",
  },
  {
    ref_id: "jargon-015",
    node_type: "Lingo",
    name: "Service Factory",
    definition: "A singleton pattern used in Hive to instantiate and cache external API service clients (e.g., StakworkService, PoolManagerService).",
    date_added_to_graph: 1750417200,
    lingo_type: "code_symbol",
  },
  {
    ref_id: "jargon-016",
    node_type: "Lingo",
    name: "WorkflowStatus",
    definition: "System-controlled automation state for tasks: PENDING, IN_PROGRESS, COMPLETED, ERROR, HALTED, or FAILED.",
    date_added_to_graph: 1750415400,
    lingo_type: "code_symbol",
  },
  {
    ref_id: "jargon-017",
    node_type: "Lingo",
    name: "Mock Fallback",
    definition: "When USE_MOCKS=true or a real external service is unreachable, API routes return pre-seeded in-memory data instead of calling the live service.",
    date_added_to_graph: 1750413600,
    lingo_type: "company_jargon",
  },
  {
    ref_id: "jargon-018",
    node_type: "Lingo",
    name: "Streaming Response",
    definition: "AI assistant replies that are delivered token-by-token to the client over a Server-Sent Events or ReadableStream connection.",
    date_added_to_graph: 1750411800,
    lingo_type: "industry_term",
  },
  {
    ref_id: "jargon-019",
    node_type: "Lingo",
    name: "Phase",
    definition: "An ordered stage within a product Feature that groups related tasks and tracks progress toward a milestone.",
    date_added_to_graph: 1750410000,
    lingo_type: "company_jargon",
  },
  {
    ref_id: "jargon-020",
    node_type: "Lingo",
    name: "Source Control Token",
    definition: "An encrypted GitHub App installation token stored per user/workspace, used to authenticate repository operations.",
    date_added_to_graph: 1750408200,
    lingo_type: "acronym",
  },
  {
    ref_id: "jargon-021",
    node_type: "Lingo",
    name: "Auto-Learn",
    definition: "A swarm setting that enables the AI to continuously ingest new code changes into the knowledge graph without manual triggers.",
    date_added_to_graph: 1750406400,
    lingo_type: "product_term",
  },
  {
    ref_id: "jargon-022",
    node_type: "Lingo",
    name: "User Journey Task",
    definition: "An E2E test scenario tracked as a task with sourceType USER_JOURNEY; test code lives in the swarm graph while metadata is stored in the DB.",
    date_added_to_graph: 1750404600,
    lingo_type: "person",
  },
];
