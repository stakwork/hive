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
 */

export const HIVE_FEATURE = "HiveFeature";
export const HIVE_TASK = "HiveTask";
export const HIVE_CHAT_MESSAGE = "HiveChatMessage";

export const EDGE_HAS_TASK = "HAS_TASK";
export const EDGE_HAS_MESSAGE = "HAS_MESSAGE";

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
