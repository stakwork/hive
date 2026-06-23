/**
 * Declarative pg relationship registry.
 *
 * Every FK column name and array field name is verified against
 * prisma/schema.prisma. No entry may reference a column or model that does
 * not exist in the real schema.
 *
 * Two entries carry `requiresMigration: true` — they are present in the
 * registry but skipped at runtime until the backing index is confirmed:
 *   - `repository → HAS_TASK`   (needs Migration 1: tasks_repository_id_idx)
 *   - `feature → BLOCKED_BY_FEATURE` (needs Migration 2: GIN index)
 */

// ---------------------------------------------------------------------------
// Resolver discriminated union
// ---------------------------------------------------------------------------

export type ForwardScalarResolver = {
  kind: "forward-scalar";
  /** FK field name on the source model row */
  field: string;
};

export type ForwardArrayResolver = {
  kind: "forward-array";
  /** String[] field name on the source model row */
  field: string;
};

export type ReverseIndexedResolver = {
  kind: "reverse-indexed";
  /** Prisma model name (lowercase), e.g. "feature", "task" */
  prismaModel: string;
  /** FK column name on the target model that points back to the source */
  fkField: string;
  /** Maximum rows returned per query (default 100) */
  take?: number;
};

export type OpaqueExternalResolver = {
  kind: "opaque-external";
  /** Field on the source row that holds the external ID */
  field: string;
  /** URN prefix to prepend, e.g. "stakwork:workflow" */
  urnPrefix: string;
};

// ---------------------------------------------------------------------------
// EdgeDefinition
// ---------------------------------------------------------------------------

export interface EdgeDefinition {
  fromType: string;
  edgeType: string;
  toType: string;
  direction: "forward" | "reverse";
  resolver:
    | ForwardScalarResolver
    | ForwardArrayResolver
    | ReverseIndexedResolver
    | OpaqueExternalResolver;
  /**
   * When true the entry is present in the registry for documentation purposes
   * but is SKIPPED at runtime by pgNeighbors. Set on edges that require a DB
   * migration (index) that may not yet be deployed.
   */
  requiresMigration?: boolean;
}

// ---------------------------------------------------------------------------
// REGISTRY — all 19 edges, schema-verified
// ---------------------------------------------------------------------------

export const REGISTRY: readonly EdgeDefinition[] = [
  // ── Feature ↔ Initiative ──────────────────────────────────────────────
  {
    fromType: "feature",
    edgeType: "BELONGS_TO_INITIATIVE",
    toType: "initiative",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "initiativeId" },
  },
  {
    fromType: "initiative",
    edgeType: "HAS_FEATURE",
    toType: "feature",
    direction: "reverse",
    // Feature.initiativeId has @@index([initiativeId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "feature",
      fkField: "initiativeId",
    },
  },

  // ── Feature ↔ Milestone ───────────────────────────────────────────────
  {
    fromType: "feature",
    edgeType: "BELONGS_TO_MILESTONE",
    toType: "milestone",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "milestoneId" },
  },
  {
    fromType: "milestone",
    edgeType: "HAS_FEATURE",
    toType: "feature",
    direction: "reverse",
    // Feature.milestoneId has @@index([milestoneId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "feature",
      fkField: "milestoneId",
    },
  },

  // ── Milestone ↔ Initiative ────────────────────────────────────────────
  {
    fromType: "milestone",
    edgeType: "BELONGS_TO_INITIATIVE",
    toType: "initiative",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "initiativeId" },
  },
  {
    fromType: "initiative",
    edgeType: "HAS_MILESTONE",
    toType: "milestone",
    direction: "reverse",
    // Milestone.initiativeId has @@index([initiativeId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "milestone",
      fkField: "initiativeId",
    },
  },

  // ── Task ↔ Feature ────────────────────────────────────────────────────
  {
    fromType: "task",
    edgeType: "BELONGS_TO_FEATURE",
    toType: "feature",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "featureId" },
  },
  {
    fromType: "feature",
    edgeType: "HAS_TASK",
    toType: "task",
    direction: "reverse",
    // Task.featureId has @@index([featureId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "task",
      fkField: "featureId",
    },
  },

  // ── Task ↔ Repository ─────────────────────────────────────────────────
  {
    fromType: "task",
    edgeType: "USES_REPOSITORY",
    toType: "repository",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "repositoryId" },
  },
  {
    fromType: "repository",
    edgeType: "HAS_TASK",
    toType: "task",
    direction: "reverse",
    // ⚠️ Requires Migration 1 (tasks_repository_id_idx).
    // Skipped at runtime until migration is confirmed deployed.
    requiresMigration: true,
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "task",
      fkField: "repositoryId",
    },
  },

  // ── Task → Deployments ────────────────────────────────────────────────
  {
    fromType: "task",
    edgeType: "HAS_DEPLOYMENT",
    toType: "deployment",
    direction: "reverse",
    // Deployment.taskId has @@index([taskId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "deployment",
      fkField: "taskId",
    },
  },

  // ── Feature feature-dependency graph ─────────────────────────────────
  {
    fromType: "feature",
    edgeType: "DEPENDS_ON_FEATURE",
    toType: "feature",
    direction: "forward",
    // Forward array read — no extra DB query needed
    resolver: { kind: "forward-array", field: "dependsOnFeatureIds" },
  },
  {
    fromType: "feature",
    edgeType: "BLOCKED_BY_FEATURE",
    toType: "feature",
    direction: "reverse",
    // ⚠️ Requires Migration 2 (GIN index on depends_on_feature_ids).
    // Uses $queryRaw with array-containment predicate — skipped until migration
    // is confirmed deployed.
    requiresMigration: true,
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "feature",
      fkField: "dependsOnFeatureIds", // special-cased in pgNeighbors (GIN $queryRaw)
    },
  },

  // ── Task → WorkflowTask ───────────────────────────────────────────────
  {
    fromType: "task",
    edgeType: "HAS_WORKFLOW_TASK",
    toType: "workflowtask",
    direction: "reverse",
    // WorkflowTask.taskId is @unique ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "workflowTask",
      fkField: "taskId",
      take: 1,
    },
  },

  // ── WorkflowTask → external Stakwork workflow ─────────────────────────
  {
    fromType: "workflowtask",
    edgeType: "REFERENCES_WORKFLOW",
    toType: "workflow",
    direction: "forward",
    // workflowId is an external Int? — emits opaque stakwork: URN,
    // no local Workflow model traversal
    resolver: {
      kind: "opaque-external",
      field: "workflowId",
      urnPrefix: "stakwork:workflow",
    },
  },

  // ── Workspace → WorkspaceMember ───────────────────────────────────────
  {
    fromType: "workspace",
    edgeType: "HAS_MEMBER",
    toType: "workspacemember",
    direction: "reverse",
    // WorkspaceMember.workspaceId has @@index([workspaceId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "workspaceMember",
      fkField: "workspaceId",
    },
  },

  // ── WorkspaceMember → User ────────────────────────────────────────────
  {
    fromType: "workspacemember",
    edgeType: "IS_USER",
    toType: "user",
    direction: "forward",
    resolver: { kind: "forward-scalar", field: "userId" },
  },

  // ── Task → ChatMessages ───────────────────────────────────────────────
  {
    fromType: "task",
    edgeType: "HAS_MESSAGE",
    toType: "chatmessage",
    direction: "reverse",
    // ChatMessage.taskId has @@index([taskId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "chatMessage",
      fkField: "taskId",
    },
  },

  // ── Feature → ChatMessages ────────────────────────────────────────────
  {
    fromType: "feature",
    edgeType: "HAS_MESSAGE",
    toType: "chatmessage",
    direction: "reverse",
    // ChatMessage.featureId has @@index([featureId]) ✅
    resolver: {
      kind: "reverse-indexed",
      prismaModel: "chatMessage",
      fkField: "featureId",
    },
  },
] as const;

// ---------------------------------------------------------------------------
// PG_NODE_TYPES — addressable entity kinds for the sibling toolset's search
// ---------------------------------------------------------------------------

/**
 * Set of all `pg:` entity kinds addressable by the graph-walker.
 * Imported by the sibling toolset feature to scope `pgSearch` type filtering.
 * No search logic lives in this module.
 */
export const PG_NODE_TYPES = new Set([
  "feature",
  "initiative",
  "milestone",
  "task",
  "user",
  "workspacemember",
  "workspace",
  "repository",
  "deployment",
  "workflowtask",
  "chatmessage",
  "research",
  "connection",
  "conversation",
]);
