/**
 * Pure mappers from Hive Postgres entities → Jarvis graph nodes/edges.
 *
 * Node identity is the Postgres id, carried in the schema node_key field
 * (feature_id / task_id / message_id). See the `Hive` schema library in
 * jarvis-backend (HiveFeature / HiveTask / HiveChatMessage).
 *
 * Edge endpoints are specified by `{ node_type, node_data }` so Jarvis can
 * resolve them by node_key — but node_data must still satisfy the schema's
 * required (non-`?`) attributes, hence the minimal endpoint helpers below
 * always include the required fields (`name`, and `message` for chat).
 *
 * NOTE on Neo4j label casing: Jarvis preserves node-type casing via its
 * `canonical_type()` resolver (it no longer runs `.capitalize()`), so the type
 * names below are stored verbatim as `HiveFeature` / `HiveTask` /
 * `HiveChatMessage` labels in Neo4j (labels are case-sensitive). Query the graph
 * with those exact PascalCase forms, e.g. `MATCH (f:HiveFeature) ...`.
 */

export const HIVE_FEATURE = "HiveFeature";
export const HIVE_TASK = "HiveTask";
export const HIVE_CHAT_MESSAGE = "HiveChatMessage";

// Org-canvas entity node types (canvas-mirror-cron).
export const HIVE_INITIATIVE = "HiveInitiative";
export const HIVE_MILESTONE = "HiveMilestone";
export const HIVE_RESEARCH = "HiveResearch";
export const HIVE_NOTE = "HiveNote";
export const HIVE_DECISION = "HiveDecision";

// In-graph edge types for org-canvas entities.
export const EDGE_HAS_MILESTONE = "HAS_MILESTONE"; // Initiative → Milestone
export const EDGE_HAS_RESEARCH = "HAS_RESEARCH"; // Initiative|Milestone → Research

// Jarvis stores node types verbatim (see the casing note above), so a `HiveTask`
// node lives under the Neo4j label `HiveTask` and must be queried as such.
// Used by the PR-link cron to read back HiveTask nodes' ref_ids.
export const HIVE_TASK_LABEL = "HiveTask";

export const EDGE_HAS_TASK = "HAS_TASK";
export const EDGE_HAS_MESSAGE = "HAS_MESSAGE";

// PR-link cron: HiveTask -RESULTED_IN-> PullRequest (the ingested code node).
// `PULL_REQUEST` is codegraph's node_type, not a Hive-owned one. Verified on
// prod: these nodes are labeled `PullRequest` (stakgraph ingests them directly)
// and carry `repo` + `number` props.
export const EDGE_RESULTED_IN = "RESULTED_IN";
export const PULL_REQUEST = "PullRequest";

export interface JarvisNodePayload {
  node_type: string;
  node_data: Record<string, unknown>;
}

export interface JarvisEdgePayload {
  edge: { edge_type: string; edge_data?: Record<string, unknown> };
  source: { node_type: string; node_data: Record<string, unknown> };
  target: { node_type: string; node_data: Record<string, unknown> };
}

// Minimal subset of fields each mapper reads. Kept loose so callers can pass
// Prisma rows (with extra fields) directly.
export interface FeatureRow {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  brief?: string | null;
  requirements?: string | null;
  architecture?: string | null;
  workspaceId?: string | null;
  assigneeId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description?: string | null;
  summary?: string | null;
  status?: string | null;
  priority?: string | null;
  sourceType?: string | null;
  branch?: string | null;
  featureId?: string | null;
  phaseId?: string | null;
  workspaceId?: string | null;
  repositoryId?: string | null;
  assigneeId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  // Parent feature (selected for edge wiring); title needed for the endpoint.
  feature?: { id: string; title: string } | null;
}

export interface ChatMessageRow {
  id: string;
  message: string;
  role?: string | null;
  status?: string | null;
  taskId?: string | null;
  featureId?: string | null;
  userId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  // Parents (one of these is set); title needed for the endpoint.
  task?: { id: string; title: string } | null;
  feature?: { id: string; title: string } | null;
}

function iso(d?: Date | null): string | undefined {
  return d ? new Date(d).toISOString() : undefined;
}

/** Drop undefined/null so Jarvis schema validation doesn't see empty props. */
function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

const SNIPPET_LEN = 80;

/** A short, human-readable `name` for a chat message node (title_key). */
export function chatMessageName(m: ChatMessageRow): string {
  const role = (m.role ?? "message").toString().toLowerCase();
  const snippet = (m.message ?? "").replace(/\s+/g, " ").trim().slice(0, SNIPPET_LEN);
  return snippet ? `${role}: ${snippet}` : role;
}

export function featureToNode(f: FeatureRow): JarvisNodePayload {
  return {
    node_type: HIVE_FEATURE,
    node_data: clean({
      feature_id: f.id,
      name: f.title,
      status: f.status,
      priority: f.priority,
      brief: f.brief,
      requirements: f.requirements,
      architecture: f.architecture,
      workspace_id: f.workspaceId,
      assignee_id: f.assigneeId,
      created_at: iso(f.createdAt),
      updated_at: iso(f.updatedAt),
    }),
  };
}

export function taskToNode(t: TaskRow): JarvisNodePayload {
  return {
    node_type: HIVE_TASK,
    node_data: clean({
      task_id: t.id,
      name: t.title,
      description: t.description,
      summary: t.summary,
      status: t.status,
      priority: t.priority,
      source_type: t.sourceType,
      branch: t.branch,
      feature_id: t.featureId,
      phase_id: t.phaseId,
      workspace_id: t.workspaceId,
      repository_id: t.repositoryId,
      assignee_id: t.assigneeId,
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
    }),
  };
}

export function chatMessageToNode(m: ChatMessageRow): JarvisNodePayload {
  return {
    node_type: HIVE_CHAT_MESSAGE,
    node_data: clean({
      message_id: m.id,
      name: chatMessageName(m),
      message: m.message,
      role: m.role,
      status: m.status,
      task_id: m.taskId,
      feature_id: m.featureId,
      user_id: m.userId,
      created_at: iso(m.createdAt),
      updated_at: iso(m.updatedAt),
    }),
  };
}

// --- Edge endpoint helpers (identity + schema-required fields only) ---

function featureEndpoint(id: string, title: string) {
  return { node_type: HIVE_FEATURE, node_data: { feature_id: id, name: title } };
}
function taskEndpoint(id: string, title: string) {
  return { node_type: HIVE_TASK, node_data: { task_id: id, name: title } };
}
function chatEndpoint(m: ChatMessageRow) {
  return {
    node_type: HIVE_CHAT_MESSAGE,
    node_data: { message_id: m.id, name: chatMessageName(m), message: m.message },
  };
}

// --- PR linking (jarvis-pr-link-cron) ---

/**
 * Parse a GitHub PR URL into `{ repo: "owner/name", number }`. The artifact's
 * `content.url` (the PR html_url) is the only reliable per-task PR reference;
 * `content.repo`/`content.number` are inconsistent across writers, so we derive
 * both from the URL. Returns null for anything that isn't a `/pull/<n>` URL.
 */
export function parsePullRequestUrl(
  url: unknown,
): { repo: string; number: number } | null {
  if (typeof url !== "string") return null;
  // .../{owner}/{repo}/pull/{number}
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  const number = Number(m[3]);
  if (!Number.isInteger(number) || number <= 0) return null;
  return { repo: `${m[1]}/${m[2]}`, number };
}

/**
 * Stable map key for matching a parsed PR ref against a `PullRequest` graph
 * node's `repo` + `number` properties. Lowercased — GitHub owner/repo are
 * case-insensitive and the graph stores them lowercased.
 */
export function prNodeKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

/**
 * HiveTask -RESULTED_IN-> PullRequest. BOTH endpoints are addressed by `ref_id`
 * (the existing HiveTask node mirrored from Postgres, and the existing ingested
 * PR node) so we never create a stub.
 *
 * This is written for the jarvis-backend `/node/edge/ref/bulk` endpoint, which
 * matches each node by ref_id against its real Neo4j label — so it links to the
 * stakgraph PR node (label `PullRequest`) regardless of node-type casing, and
 * addresses two nodes we already know exist, so it never creates a stub.
 */
export function taskPrEdge(
  taskRefId: string,
  prRefId: string,
): {
  edge: { edge_type: string };
  source_ref_id: string;
  target_ref_id: string;
} {
  return {
    edge: { edge_type: EDGE_RESULTED_IN },
    source_ref_id: taskRefId,
    target_ref_id: prRefId,
  };
}

/** HiveFeature -HAS_TASK-> HiveTask, when the task belongs to a feature. */
export function taskEdge(t: TaskRow): JarvisEdgePayload | null {
  if (!t.feature) return null;
  return {
    edge: { edge_type: EDGE_HAS_TASK },
    source: featureEndpoint(t.feature.id, t.feature.title),
    target: taskEndpoint(t.id, t.title),
  };
}

/**
 * HiveTask|HiveFeature -HAS_MESSAGE-> HiveChatMessage, depending on which
 * parent the message is attached to. Returns null if neither parent is present.
 */
export function chatMessageEdge(m: ChatMessageRow): JarvisEdgePayload | null {
  if (m.task) {
    return {
      edge: { edge_type: EDGE_HAS_MESSAGE },
      source: taskEndpoint(m.task.id, m.task.title),
      target: chatEndpoint(m),
    };
  }
  if (m.feature) {
    return {
      edge: { edge_type: EDGE_HAS_MESSAGE },
      source: featureEndpoint(m.feature.id, m.feature.title),
      target: chatEndpoint(m),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Org-canvas entity mappers (canvas-mirror-cron)
// ---------------------------------------------------------------------------

export interface InitiativeRow {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  orgId?: string | null;
  assigneeId?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface MilestoneRow {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  sequence?: number | null;
  initiativeId?: string | null;
  assigneeId?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface ResearchRow {
  id: string;
  slug: string;
  topic: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  orgId?: string | null;
  initiativeId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface CanvasNoteRow {
  id: string;
  text: string;
  category: "note" | "decision";
  x?: number | null;
  y?: number | null;
  // canvasRef is the Canvas.ref this node was extracted from (for node_data provenance)
  canvasRef?: string | null;
}

export function initiativeToNode(i: InitiativeRow): JarvisNodePayload {
  return {
    node_type: HIVE_INITIATIVE,
    node_data: clean({
      initiative_id: i.id,
      name: i.name,
      description: i.description,
      status: i.status,
      org_id: i.orgId,
      assignee_id: i.assigneeId,
      start_date: iso(i.startDate),
      target_date: iso(i.targetDate),
      completed_at: iso(i.completedAt),
      created_at: iso(i.createdAt),
      updated_at: iso(i.updatedAt),
    }),
  };
}

export function milestoneToNode(m: MilestoneRow): JarvisNodePayload {
  return {
    node_type: HIVE_MILESTONE,
    node_data: clean({
      milestone_id: m.id,
      name: m.name,
      description: m.description,
      status: m.status,
      sequence: m.sequence,
      initiative_id: m.initiativeId,
      assignee_id: m.assigneeId,
      due_date: iso(m.dueDate),
      completed_at: iso(m.completedAt),
      created_at: iso(m.createdAt),
      updated_at: iso(m.updatedAt),
    }),
  };
}

export function researchToNode(r: ResearchRow): JarvisNodePayload {
  return {
    node_type: HIVE_RESEARCH,
    node_data: clean({
      research_id: r.id,
      name: r.title,
      slug: r.slug,
      topic: r.topic,
      summary: r.summary,
      content: r.content,
      org_id: r.orgId,
      initiative_id: r.initiativeId,
      created_at: iso(r.createdAt),
      updated_at: iso(r.updatedAt),
    }),
  };
}

export function noteToNode(n: CanvasNoteRow): JarvisNodePayload {
  return {
    node_type: HIVE_NOTE,
    node_data: clean({
      note_id: n.id,
      name: n.text.replace(/\s+/g, " ").trim().slice(0, 80) || "(note)",
      text: n.text,
      canvas_ref: n.canvasRef,
      x: n.x,
      y: n.y,
    }),
  };
}

export function decisionToNode(n: CanvasNoteRow): JarvisNodePayload {
  return {
    node_type: HIVE_DECISION,
    node_data: clean({
      decision_id: n.id,
      name: n.text.replace(/\s+/g, " ").trim().slice(0, 80) || "(decision)",
      text: n.text,
      canvas_ref: n.canvasRef,
      x: n.x,
      y: n.y,
    }),
  };
}

// --- Org-canvas endpoint helpers (identity + required schema fields only) ---

function initiativeEndpoint(id: string, name: string) {
  return { node_type: HIVE_INITIATIVE, node_data: { initiative_id: id, name } };
}

function milestoneEndpoint(id: string, name: string) {
  return { node_type: HIVE_MILESTONE, node_data: { milestone_id: id, name } };
}

function researchEndpoint(id: string, title: string, slug: string) {
  return { node_type: HIVE_RESEARCH, node_data: { research_id: id, name: title, slug } };
}

/** HiveInitiative -HAS_MILESTONE-> HiveMilestone */
export function initiativeMilestoneEdge(
  initiative: { id: string; name: string },
  milestone: { id: string; name: string },
): JarvisEdgePayload {
  return {
    edge: { edge_type: EDGE_HAS_MILESTONE },
    source: initiativeEndpoint(initiative.id, initiative.name),
    target: milestoneEndpoint(milestone.id, milestone.name),
  };
}

/** HiveInitiative -HAS_RESEARCH-> HiveResearch */
export function initiativeResearchEdge(
  initiative: { id: string; name: string },
  research: { id: string; title: string; slug: string },
): JarvisEdgePayload {
  return {
    edge: { edge_type: EDGE_HAS_RESEARCH },
    source: initiativeEndpoint(initiative.id, initiative.name),
    target: researchEndpoint(research.id, research.title, research.slug),
  };
}

/** HiveMilestone -HAS_RESEARCH-> HiveResearch (when research has milestoneId) */
export function milestoneResearchEdge(
  milestone: { id: string; name: string },
  research: { id: string; title: string; slug: string },
): JarvisEdgePayload {
  return {
    edge: { edge_type: EDGE_HAS_RESEARCH },
    source: milestoneEndpoint(milestone.id, milestone.name),
    target: researchEndpoint(research.id, research.title, research.slug),
  };
}
