export interface JargonNode {
  ref_id: string;
  name: string;
  jargon_context: string;
  jargon_candidates: string[];
  created_at: string;
}

export interface JargonDefinition {
  ref_id: string;
  text: string;
  valid_from: string;   // ISO 8601 date
  valid_until: string | null; // null = current/active definition
}

// Seeded JargonDefinition nodes — 2 Jargon nodes × 2 chained defs each.
// Each pair has one superseded (valid_until set) and one current (valid_until = null).
export const mockJargonDefinitions: JargonDefinition[] = [
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

export const mockLingoNodes: JargonNode[] = [
  {
    ref_id: "jargon-001",
    name: "Pod Orchestration",
    jargon_context: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
    jargon_candidates: ["pod management", "container orchestration", "swarm pods"],
    created_at: "2026-06-20T18:00:00Z",
  },
  {
    ref_id: "jargon-002",
    name: "Janitor Workflow",
    jargon_context: "An automated code quality sweep that analyses a repository for test coverage gaps, security vulnerabilities, and refactoring opportunities.",
    jargon_candidates: ["janitor", "code sweep", "automated review"],
    created_at: "2026-06-20T17:30:00Z",
  },
  {
    ref_id: "jargon-003",
    name: "Swarm",
    jargon_context: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
    jargon_candidates: ["agent cluster", "AI swarm", "workspace swarm"],
    created_at: "2026-06-20T17:00:00Z",
  },
  {
    ref_id: "jargon-004",
    name: "StakworkRun",
    jargon_context: "A tracked execution of a Stakwork AI workflow, recording inputs, outputs, and status transitions for audit and debugging.",
    jargon_candidates: ["workflow run", "stakwork execution", "AI run"],
    created_at: "2026-06-20T16:30:00Z",
  },
  {
    ref_id: "jargon-005",
    name: "Feature Brief",
    jargon_context: "A structured description of a product feature including requirements, architecture notes, and linked user stories.",
    jargon_candidates: ["feature spec", "brief", "product brief"],
    created_at: "2026-06-20T16:00:00Z",
  },
  {
    ref_id: "jargon-006",
    name: "Workspace Slug",
    jargon_context: "A URL-safe, lowercase identifier for a workspace used in routing (e.g., /w/my-workspace). Must not contain capitals, spaces, or leading/trailing hyphens.",
    jargon_candidates: ["slug", "workspace identifier", "url slug"],
    created_at: "2026-06-20T15:30:00Z",
  },
  {
    ref_id: "jargon-007",
    name: "Dual Status System",
    jargon_context: "Tasks carry two independent status fields: `status` for user/PM work tracking and `workflowStatus` for system automation state.",
    jargon_candidates: ["task status", "workflow status", "dual status"],
    created_at: "2026-06-20T15:00:00Z",
  },
  {
    ref_id: "jargon-008",
    name: "Field-Level Encryption",
    jargon_context: "AES-256-GCM encryption applied to individual sensitive database fields (e.g., API keys, tokens) using the EncryptionService.",
    jargon_candidates: ["field encryption", "AES-256", "data encryption"],
    created_at: "2026-06-20T14:30:00Z",
  },
  {
    ref_id: "jargon-009",
    name: "Jarvis",
    jargon_context: "The graph database backend (ArcadeDB) that stores knowledge nodes and edges for a workspace swarm.",
    jargon_candidates: ["jarvis backend", "graph DB", "knowledge graph"],
    created_at: "2026-06-20T14:00:00Z",
  },
  {
    ref_id: "jargon-010",
    name: "IDOR Guard",
    jargon_context: "Insecure Direct Object Reference protection ensuring that authenticated users can only access resources belonging to their authorised workspace.",
    jargon_candidates: ["IDOR", "access guard", "authorization check"],
    created_at: "2026-06-20T13:30:00Z",
  },
  {
    ref_id: "jargon-011",
    name: "IntersectionObserver Sentinel",
    jargon_context: "A zero-height div placed at the bottom of a scrollable list that, when it enters the viewport, triggers the next page fetch for infinite scroll.",
    jargon_candidates: ["sentinel element", "scroll trigger", "infinite scroll"],
    created_at: "2026-06-20T13:00:00Z",
  },
  {
    ref_id: "jargon-012",
    name: "Optimistic Update",
    jargon_context: "A UI pattern where the interface reflects the expected result of an action immediately, before the server confirms success, improving perceived responsiveness.",
    jargon_candidates: ["optimistic UI", "optimistic state", "immediate feedback"],
    created_at: "2026-06-20T12:30:00Z",
  },
  {
    ref_id: "jargon-013",
    name: "Breadcrumb Trail",
    jargon_context: "A navigation aid displaying the sequence of nodes a user has traversed in the graph explorer, allowing step-back navigation.",
    jargon_candidates: ["breadcrumb", "navigation trail", "graph path"],
    created_at: "2026-06-20T12:00:00Z",
  },
  {
    ref_id: "jargon-014",
    name: "Pusher Channel",
    jargon_context: "A real-time event channel provided by Pusher used to broadcast live updates (e.g., task status, workflow progress) to connected clients.",
    jargon_candidates: ["pusher", "real-time channel", "websocket channel"],
    created_at: "2026-06-20T11:30:00Z",
  },
  {
    ref_id: "jargon-015",
    name: "Service Factory",
    jargon_context: "A singleton pattern used in Hive to instantiate and cache external API service clients (e.g., StakworkService, PoolManagerService).",
    jargon_candidates: ["service factory", "singleton service", "factory pattern"],
    created_at: "2026-06-20T11:00:00Z",
  },
  {
    ref_id: "jargon-016",
    name: "WorkflowStatus",
    jargon_context: "System-controlled automation state for tasks: PENDING, IN_PROGRESS, COMPLETED, ERROR, HALTED, or FAILED.",
    jargon_candidates: ["workflow status", "automation state", "system status"],
    created_at: "2026-06-20T10:30:00Z",
  },
  {
    ref_id: "jargon-017",
    name: "Mock Fallback",
    jargon_context: "When USE_MOCKS=true or a real external service is unreachable, API routes return pre-seeded in-memory data instead of calling the live service.",
    jargon_candidates: ["mock mode", "mock fallback", "development mock"],
    created_at: "2026-06-20T10:00:00Z",
  },
  {
    ref_id: "jargon-018",
    name: "Streaming Response",
    jargon_context: "AI assistant replies that are delivered token-by-token to the client over a Server-Sent Events or ReadableStream connection.",
    jargon_candidates: ["AI streaming", "SSE stream", "token stream"],
    created_at: "2026-06-20T09:30:00Z",
  },
  {
    ref_id: "jargon-019",
    name: "Phase",
    jargon_context: "An ordered stage within a product Feature that groups related tasks and tracks progress toward a milestone.",
    jargon_candidates: ["feature phase", "sprint phase", "milestone phase"],
    created_at: "2026-06-20T09:00:00Z",
  },
  {
    ref_id: "jargon-020",
    name: "Source Control Token",
    jargon_context: "An encrypted GitHub App installation token stored per user/workspace, used to authenticate repository operations.",
    jargon_candidates: ["GitHub token", "install token", "source control credential"],
    created_at: "2026-06-20T08:30:00Z",
  },
  {
    ref_id: "jargon-021",
    name: "Auto-Learn",
    jargon_context: "A swarm setting that enables the AI to continuously ingest new code changes into the knowledge graph without manual triggers.",
    jargon_candidates: ["auto learn", "continuous ingestion", "auto ingest"],
    created_at: "2026-06-20T08:00:00Z",
  },
  {
    ref_id: "jargon-022",
    name: "User Journey Task",
    jargon_context: "An E2E test scenario tracked as a task with sourceType USER_JOURNEY; test code lives in the swarm graph while metadata is stored in the DB.",
    jargon_candidates: ["user journey", "E2E task", "journey test"],
    created_at: "2026-06-20T07:30:00Z",
  },
];
