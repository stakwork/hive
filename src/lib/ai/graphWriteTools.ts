/**
 * Graph-write tools for Jamie (the canvas agent).
 *
 * Exposes six `propose_*` tools that emit approvable proposal cards
 * without performing any Jarvis writes — four that add to the graph
 * (a node, a node edit, one or many edges) and two that edit it (remove
 * an edge, move a node to a new parent). The write only happens after
 * the user clicks Approve in the ProposalCard UI, which calls the
 * approval handlers in `handleApproval.ts`.
 *
 * No `namespace` or `create_schema_if_missing` parameter is ever exposed
 * to the model — deliberately omitted to prevent ontology extension and
 * namespace pollution from user-approved chat clicks.
 *
 * Access is validated at propose time via `resolveGraphJarvis` — credentials
 * are obtained and immediately discarded (never written to the transcript).
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import {
  findEdgeByEndpoints,
  isSafeRefId,
  listIncomingEdges,
  readNodeByRef,
} from "@/services/swarm/api/nodes";
import { kgGetOntology } from "@/lib/ai/kg-adapter";
import { DEFAULT_MOVE_EDGE, findReservedKeys, wouldCycle } from "@/lib/proposals/graphWriteValidation";
import { readNodeDeleteSummary } from "@/lib/proposals/nodeDeleteSummary";
import { typeFromLabels } from "@/lib/strut-run-graph/hydrate";
import {
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
  type GraphEdgeDeleteProposalPayload,
  type GraphNodeMoveProposalPayload,
  type GraphNodeDeleteProposalPayload,
  type ProposalOutput,
} from "@/lib/proposals/types";

// ─── Constants ────────────────────────────────────────────────────────────

/** Maximum triplets in a single batch proposal. */
const BATCH_TRIPLET_CAP = 25;

/**
 * Mirror-owned node types. Written by `jarvis-mirror-cron` /
 * `canvas-mirror-cron` via `addNodeBulk(..., { reprocess: true })`.
 * Edits to these types would be silently reverted on the next pass.
 */
const MIRROR_OWNED_TYPES = new Set([
  "HiveFeature",
  "HiveTask",
  "HiveChatMessage",
  "ErrorIssue",
  "Initiative",
  "Milestone",
  "Research",
]);

/**
 * stakgraph-ingested node types (stakgraph's `NodeType`). Written by the
 * code-ingestion pipeline keyed on `unique_source_id`; a graph-write delete
 * or edit of one of these would be silently merged back or duplicated on
 * the next ingestion pass. Checked against both the resolved `node_type`
 * and every label on the node — an ingested node can carry a `Domain_*`
 * label alongside its real type.
 */
export const CODE_GRAPH_OWNED_TYPES = new Set([
  "Repository",
  "Directory",
  "File",
  "Function",
  "Class",
  "Trait",
  "Datamodel",
  "Request",
  "Endpoint",
  "Page",
  "Var",
  "Import",
  "Library",
  "Language",
  "UnitTest",
  "IntegrationTest",
  "E2etest",
]);

/**
 * Guards `propose_delete_node` / `approveGraphNodeDelete` against the
 * `unique_source_id` cascade on a swarm still running today's Jarvis
 * (`DELETE /v2/nodes/<ref_id>` deletes every node sharing the same
 * `unique_source_id`, not just the target). Flip to `true` only after
 * every swarm runs the single-node delete — see the feature's Jarvis
 * dependency note.
 */
export const ALLOW_UNIQUE_SOURCE_ID_DELETE = false;

// ─── Validation helpers ───────────────────────────────────────────────────

/**
 * XOR-validate a triplet endpoint: exactly one of `ref_id` or
 * (`node_type` + `node_data`) must be present.
 */
function validateEndpoint(endpoint: unknown, label: string): string | null {
  const e = endpoint as Record<string, unknown>;
  const hasRef = typeof e?.ref_id === "string" && e.ref_id.length > 0;
  const hasInline =
    typeof e?.node_type === "string" &&
    e.node_type.length > 0 &&
    e?.node_data !== null &&
    typeof e?.node_data === "object";

  if (hasRef && hasInline) {
    return `${label}: provide either ref_id OR (node_type + node_data), not both.`;
  }
  if (!hasRef && !hasInline) {
    return `${label}: provide either ref_id OR (node_type + node_data).`;
  }
  return null;
}

/** What a move proposal's card shows besides the workspace and a refusal: the names read at propose time. */
type MoveMeta = Omit<
  Extract<ProposalOutput, { kind: "graphNodeMove" }>["meta"],
  "refusedReason" | "workspaceSlug"
>;

/** What a delete proposal's card shows besides the workspace and a refusal. */
type DeleteMeta = Omit<
  Extract<ProposalOutput, { kind: "graphNodeDelete" }>["meta"],
  "refusedReason" | "workspaceSlug"
>;

/** A node's display name off its Jarvis properties, when it has one. */
function nameOf(properties: Record<string, unknown> | undefined): string | undefined {
  const name = properties?.name ?? properties?.title;
  return typeof name === "string" && name ? name : undefined;
}

// ─── Ontology helpers ─────────────────────────────────────────────────────

async function fetchKgNodeTypes(
  jarvisUrl: string,
  apiKey: string,
): Promise<Set<string> | null> {
  try {
    const { node_types } = await kgGetOntology(jarvisUrl, apiKey);
    return new Set(node_types.map((t) => t.type));
  } catch {
    return null;
  }
}

// ─── Zod schemas ──────────────────────────────────────────────────────────

const EndpointSchema = z.union([
  z.object({
    ref_id: z.string().min(1).describe("Existing node ref_id."),
  }),
  z.object({
    node_type: z.string().min(1).describe("Node type for create-or-merge."),
    node_data: z
      .record(z.string(), z.unknown())
      .describe("Node attributes for create-or-merge."),
  }),
]);

const TripletItemSchema = z.object({
  edge_type: z.string().min(1).describe("Edge/relationship type."),
  edge_data: z.record(z.string(), z.unknown()).optional().describe("Edge attributes."),
  weight: z.number().optional().describe("Edge weight (0–1)."),
  source: EndpointSchema.describe("Source node — ref_id OR inline spec."),
  target: EndpointSchema.describe("Target node — ref_id OR inline spec."),
});

type EndpointInput =
  | { ref_id: string }
  | { node_type: string; node_data: Record<string, unknown> };

type TripletItem = {
  edge_type: string;
  edge_data?: Record<string, unknown>;
  weight?: number;
  source: EndpointInput;
  target: EndpointInput;
};

// ─── Tool factory ─────────────────────────────────────────────────────────

export function buildGraphWriteTools(orgId: string, userId: string): ToolSet {
  return {
    // ── propose_create_node ───────────────────────────────────────────────

    [PROPOSE_CREATE_NODE_TOOL]: tool({
      description:
        "Propose creating a new node in the workspace knowledge graph. " +
        "Emits an approvable card — no write happens until the user clicks Approve. " +
        "Requires a valid `node_type` from `graph_ontology`. " +
        "Reserved attribute keys (status, is_deleted, is_muted, boost, ref_id, algo_*) are rejected. " +
        "No `namespace` or `create_schema_if_missing` parameter.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "Slug of the workspace whose KG the node will be created in.",
          ),
        node_type: z
          .string()
          .min(1)
          .describe("Node type — must be a valid type from graph_ontology."),
        node_data: z
          .record(z.string(), z.unknown())
          .describe(
            "Node attributes. Reserved keys (status, is_deleted, is_muted, boost, ref_id, algo_*) are rejected.",
          ),
        rationale: z
          .string()
          .optional()
          .describe("Why this node should be created."),
      }),
      execute: async ({ workspaceSlug, node_type, node_data, rationale }) => {
        // 1. Validate reserved keys
        const badKeys = findReservedKeys(node_data as Record<string, unknown>);
        if (badKeys.length > 0) {
          return {
            error: `node_data contains reserved key(s): ${badKeys.join(", ")}. Remove them and try again.`,
          };
        }

        // 2. Resolve access (validates workspace membership + role)
        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) {
          return { error: resolved.error };
        }
        const {
          workspaceId,
          workspaceSlug: verifiedSlug,
          config,
        } = resolved.access;

        // 3. Validate node_type against ontology (best-effort)
        const nodeTypes = await fetchKgNodeTypes(config.jarvisUrl, config.apiKey);
        if (nodeTypes && nodeTypes.size > 0 && !nodeTypes.has(node_type)) {
          return {
            error: `Unknown node_type "${node_type}". Call graph_ontology to see valid types.`,
          };
        }

        // 4. Credentials discarded — proposal carries only safe fields
        const proposalId = nanoid();
        return {
          kind: "graphNodeCreate" as const,
          proposalId,
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            node_type,
            node_data: node_data as Record<string, unknown>,
          },
          ...(rationale ? { rationale } : {}),
          meta: { workspaceSlug: verifiedSlug },
        };
      },
    }),

    // ── propose_node_edit ─────────────────────────────────────────────────

    [PROPOSE_NODE_EDIT_TOOL]: tool({
      description:
        "Propose merging new attribute values into an existing KG node. " +
        "Performs a READ of the current node at propose time to populate a diff view " +
        "and confirm the node exists in this workspace's graph. " +
        "Mirror-owned node types (HiveFeature, HiveTask, HiveChatMessage, ErrorIssue, " +
        "Initiative, Milestone, Research) are not editable — edits would be silently " +
        "reverted by the next mirror pass. No `namespace` parameter.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe("Slug of the workspace the node belongs to."),
        ref_id: z
          .string()
          .min(1)
          .describe(
            "ref_id of the node to edit, obtained from graph_get / graph_search.",
          ),
        node_data: z
          .record(z.string(), z.unknown())
          .describe(
            "Attribute key/values to merge into the node. Reserved keys are rejected.",
          ),
        rationale: z
          .string()
          .optional()
          .describe("Why this edit should be made."),
      }),
      execute: async ({ workspaceSlug, ref_id, node_data, rationale }) => {
        // 1. Validate reserved keys
        const badKeys = findReservedKeys(node_data as Record<string, unknown>);
        if (badKeys.length > 0) {
          return {
            error: `node_data contains reserved key(s): ${badKeys.join(", ")}. Remove them and try again.`,
          };
        }

        // 2. Resolve access
        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) {
          return { error: resolved.error };
        }
        const {
          workspaceId,
          workspaceSlug: verifiedSlug,
          config,
        } = resolved.access;

        // 3. Read the current node to: (a) verify it exists, (b) check its type,
        //    (c) populate the diff snapshot for the card.
        const existing = await readNodeByRef(config, ref_id);
        if (!existing.success) {
          return {
            kind: "graphNodeEdit" as const,
            proposalId: nanoid(),
            payload: {
              workspaceId,
              workspaceSlug: verifiedSlug,
              ref_id,
              node_data: node_data as Record<string, unknown>,
            },
            meta: {
              oldStr: "",
              newStr: "",
              workspaceSlug: verifiedSlug,
              refusedReason: `Node "${ref_id}" was not found in this workspace's graph.`,
            },
          };
        }

        // 4. Reject mirror-owned types
        const nodeType = existing.node_type ?? "";
        if (MIRROR_OWNED_TYPES.has(nodeType)) {
          return {
            kind: "graphNodeEdit" as const,
            proposalId: nanoid(),
            payload: {
              workspaceId,
              workspaceSlug: verifiedSlug,
              ref_id,
              node_data: node_data as Record<string, unknown>,
            },
            meta: {
              oldStr: "",
              newStr: "",
              node_type: nodeType,
              workspaceSlug: verifiedSlug,
              refusedReason: `"${nodeType}" is a mirror-owned type — edits would be silently reverted by the next sync pass.`,
            },
          };
        }

        // 5. Build diff snapshot
        const oldProps = existing.properties ?? {};
        const mergedProps = {
          ...oldProps,
          ...(node_data as Record<string, unknown>),
        };
        const oldStr = JSON.stringify(oldProps, null, 2);
        const newStr = JSON.stringify(mergedProps, null, 2);

        const proposalId = nanoid();
        return {
          kind: "graphNodeEdit" as const,
          proposalId,
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            ref_id,
            node_data: node_data as Record<string, unknown>,
          },
          ...(rationale ? { rationale } : {}),
          meta: {
            oldStr,
            newStr,
            node_type: nodeType,
            workspaceSlug: verifiedSlug,
          },
        };
      },
    }),

    // ── propose_create_triplet ────────────────────────────────────────────

    [PROPOSE_CREATE_TRIPLET_TOOL]: tool({
      description:
        "Propose creating a single source→edge→target triplet in the workspace KG. " +
        "Each endpoint is either a ref_id (existing node) OR an inline node spec " +
        "(node_type + node_data for create-or-merge) — not both. " +
        "No `namespace` or `create_schema_if_missing`.",
      inputSchema: z.object({
        workspaceSlug: z.string().min(1).describe("Workspace slug."),
        edge_type: z.string().min(1).describe("Relationship/edge type."),
        edge_data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Edge attributes."),
        weight: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Edge weight (0–1)."),
        source: EndpointSchema.describe("Source node."),
        target: EndpointSchema.describe("Target node."),
        rationale: z
          .string()
          .optional()
          .describe("Why this relationship should exist."),
      }),
      execute: async ({
        workspaceSlug,
        edge_type,
        edge_data,
        weight,
        source,
        target,
        rationale,
      }) => {
        // 1. XOR-validate endpoints
        const srcErr = validateEndpoint(source, "source");
        if (srcErr) return { error: srcErr };
        const tgtErr = validateEndpoint(target, "target");
        if (tgtErr) return { error: tgtErr };

        // 2. Validate reserved keys
        if (edge_data) {
          const badKeys = findReservedKeys(
            edge_data as Record<string, unknown>,
          );
          if (badKeys.length > 0) {
            return {
              error: `edge_data contains reserved key(s): ${badKeys.join(", ")}.`,
            };
          }
        }
        const srcData = (source as Record<string, unknown>).node_data as
          | Record<string, unknown>
          | undefined;
        if (srcData) {
          const badKeys = findReservedKeys(srcData);
          if (badKeys.length > 0) {
            return {
              error: `source.node_data contains reserved key(s): ${badKeys.join(", ")}.`,
            };
          }
        }
        const tgtData = (target as Record<string, unknown>).node_data as
          | Record<string, unknown>
          | undefined;
        if (tgtData) {
          const badKeys = findReservedKeys(tgtData);
          if (badKeys.length > 0) {
            return {
              error: `target.node_data contains reserved key(s): ${badKeys.join(", ")}.`,
            };
          }
        }

        // 3. Resolve access
        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) return { error: resolved.error };
        const { workspaceId, workspaceSlug: verifiedSlug } = resolved.access;

        // 4. Return proposal (no write)
        const proposalId = nanoid();
        return {
          kind: "graphTripletCreate" as const,
          proposalId,
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            edge_type,
            ...(edge_data
              ? { edge_data: edge_data as Record<string, unknown> }
              : {}),
            ...(weight !== undefined ? { weight } : {}),
            source: source as EndpointInput,
            target: target as EndpointInput,
          },
          ...(rationale ? { rationale } : {}),
          meta: { workspaceSlug: verifiedSlug },
        };
      },
    }),

    // ── propose_create_batch_triplet ──────────────────────────────────────

    [PROPOSE_CREATE_BATCH_TRIPLET_TOOL]: tool({
      description:
        `Propose creating up to ${BATCH_TRIPLET_CAP} source→edge→target triplets in one batch. ` +
        "Each triplet follows the same rules as propose_create_triplet. " +
        "On approval, triplets are processed sequentially; partial failures return " +
        "per-item results. No `namespace` or `create_schema_if_missing`.",
      inputSchema: z.object({
        workspaceSlug: z.string().min(1).describe("Workspace slug."),
        triplets: z
          .array(TripletItemSchema)
          .min(1)
          .max(BATCH_TRIPLET_CAP)
          .describe(`Array of triplets to create (max ${BATCH_TRIPLET_CAP}).`),
        rationale: z
          .string()
          .optional()
          .describe("Why these relationships should exist."),
      }),
      execute: async ({ workspaceSlug, triplets, rationale }) => {
        // 1. Cap check (Zod enforces max, but be defensive)
        if (triplets.length > BATCH_TRIPLET_CAP) {
          return {
            error: `Batch exceeds the ${BATCH_TRIPLET_CAP}-triplet cap. Split into smaller batches.`,
          };
        }

        // 2. Validate each triplet
        for (let i = 0; i < triplets.length; i++) {
          const t = triplets[i] as Record<string, unknown>;
          const src = t.source as unknown;
          const tgt = t.target as unknown;

          const srcErr = validateEndpoint(src, `triplets[${i}].source`);
          if (srcErr) return { error: srcErr };
          const tgtErr = validateEndpoint(tgt, `triplets[${i}].target`);
          if (tgtErr) return { error: tgtErr };

          const edgeData = t.edge_data as Record<string, unknown> | undefined;
          if (edgeData) {
            const badKeys = findReservedKeys(edgeData);
            if (badKeys.length > 0) {
              return {
                error: `triplets[${i}].edge_data contains reserved key(s): ${badKeys.join(", ")}.`,
              };
            }
          }
          const sData = (src as Record<string, unknown>).node_data as
            | Record<string, unknown>
            | undefined;
          if (sData) {
            const badKeys = findReservedKeys(sData);
            if (badKeys.length > 0) {
              return {
                error: `triplets[${i}].source.node_data contains reserved key(s): ${badKeys.join(", ")}.`,
              };
            }
          }
          const tData = (tgt as Record<string, unknown>).node_data as
            | Record<string, unknown>
            | undefined;
          if (tData) {
            const badKeys = findReservedKeys(tData);
            if (badKeys.length > 0) {
              return {
                error: `triplets[${i}].target.node_data contains reserved key(s): ${badKeys.join(", ")}.`,
              };
            }
          }
        }

        // 3. Resolve access
        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) return { error: resolved.error };
        const { workspaceId, workspaceSlug: verifiedSlug } = resolved.access;

        // 4. Return proposal (no write)
        const proposalId = nanoid();
        return {
          kind: "graphBatchTripletCreate" as const,
          proposalId,
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            triplets: triplets as TripletItem[],
          },
          ...(rationale ? { rationale } : {}),
          meta: { workspaceSlug: verifiedSlug },
        };
      },
    }),

    // ── propose_delete_edge ───────────────────────────────────────────────

    [PROPOSE_DELETE_EDGE_TOOL]: tool({
      description:
        "Propose removing one existing relationship (source)-[:edge_type]->(target) from the workspace KG. " +
        "Both ends are ref_ids of existing nodes (from graph_get / graph_neighbors / graph_search). " +
        "The edge is looked up by its ends at propose time to confirm it exists, and again on approval. " +
        "Emits an approvable card — nothing is removed until the user clicks Approve. " +
        "To put a node under a different parent, use propose_move_node instead of a delete plus a create.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe("Slug of the workspace the edge belongs to."),
        edge_type: z
          .string()
          .min(1)
          .describe("Relationship type of the edge to remove, e.g. PARENT_OF."),
        source_ref_id: z
          .string()
          .min(1)
          .describe("ref_id of the node the edge starts from (the parent, for PARENT_OF)."),
        target_ref_id: z
          .string()
          .min(1)
          .describe("ref_id of the node the edge points to (the child, for PARENT_OF)."),
        rationale: z
          .string()
          .optional()
          .describe("Why this relationship should be removed."),
      }),
      execute: async ({ workspaceSlug, edge_type, source_ref_id, target_ref_id, rationale }) => {
        if (source_ref_id === target_ref_id) {
          return { error: "source_ref_id and target_ref_id must be different nodes." };
        }

        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) return { error: resolved.error };
        const {
          workspaceId,
          workspaceSlug: verifiedSlug,
          config,
        } = resolved.access;

        const payload: GraphEdgeDeleteProposalPayload = {
          workspaceId,
          workspaceSlug: verifiedSlug,
          edge_type,
          source_ref_id,
          target_ref_id,
        };

        // Read the edge to confirm it exists and to name its ends on the card.
        // Credentials are discarded; the proposal carries only safe fields.
        const found = await findEdgeByEndpoints(config, { source_ref_id, edge_type, target_ref_id });
        if (!found.success) {
          return { error: found.message ?? "Could not read the edge from the workspace's graph." };
        }
        if (!found.edge) {
          return {
            kind: "graphEdgeDelete" as const,
            proposalId: nanoid(),
            payload,
            meta: {
              workspaceSlug: verifiedSlug,
              refusedReason: `No ${edge_type} edge from "${source_ref_id}" to "${target_ref_id}" was found in this workspace's graph.`,
            },
          };
        }

        return {
          kind: "graphEdgeDelete" as const,
          proposalId: nanoid(),
          payload,
          ...(rationale ? { rationale } : {}),
          meta: {
            workspaceSlug: verifiedSlug,
            edge_ref_id: found.edge.ref_id,
            ...(found.edge.source_name ? { source_name: found.edge.source_name } : {}),
            ...(found.edge.target_name ? { target_name: found.edge.target_name } : {}),
          },
        };
      },
    }),

    // ── propose_move_node ─────────────────────────────────────────────────

    [PROPOSE_MOVE_NODE_TOOL]: tool({
      description:
        "Propose moving a node from under its current parent to under another, along one edge type " +
        "(PARENT_OF by default — the concept tree). The node is the edge's target; the parents are its sources. " +
        "On approval the new link is created first and the old one removed second, so the node is never left orphaned. " +
        "`from_ref_id` can be omitted when the node has exactly one parent along that edge; " +
        "a node with several parents needs it. A node with no parent is not a move — use propose_create_triplet. " +
        "Refused for mirror-owned node types and, along PARENT_OF, for a destination under the node itself (a cycle). " +
        "Emits an approvable card — nothing changes until the user clicks Approve.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe("Slug of the workspace the node belongs to."),
        ref_id: z.string().min(1).describe("ref_id of the node to move."),
        to_ref_id: z
          .string()
          .min(1)
          .describe("ref_id of the node it should sit under afterwards."),
        from_ref_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            "ref_id of the parent it sits under now. Optional when the node has exactly one parent along edge_type.",
          ),
        edge_type: z
          .string()
          .min(1)
          .default(DEFAULT_MOVE_EDGE)
          .describe("Edge type the move follows (parent → node). Defaults to PARENT_OF."),
        rationale: z
          .string()
          .optional()
          .describe("Why the node belongs under the new parent."),
      }),
      execute: async ({ workspaceSlug, ref_id, to_ref_id, from_ref_id, edge_type, rationale }) => {
        if (to_ref_id === ref_id) {
          return { error: "to_ref_id must be a different node from ref_id — a node cannot be its own parent." };
        }
        if (from_ref_id && from_ref_id === to_ref_id) {
          return { error: "from_ref_id and to_ref_id are the same node — nothing would move." };
        }

        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) return { error: resolved.error };
        const {
          workspaceId,
          workspaceSlug: verifiedSlug,
          config,
        } = resolved.access;

        const refuse = (from: string, meta: MoveMeta, refusedReason: string) => ({
          kind: "graphNodeMove" as const,
          proposalId: nanoid(),
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            ref_id,
            edge_type,
            from_ref_id: from,
            to_ref_id,
          } satisfies GraphNodeMoveProposalPayload,
          meta: { workspaceSlug: verifiedSlug, ...meta, refusedReason },
        });

        // 1. The node: must exist and must not be mirror-owned (its links
        //    would be restored by the next sync pass).
        const node = await readNodeByRef(config, ref_id);
        if (!node.success) {
          return refuse(from_ref_id ?? "", {}, `Node "${ref_id}" was not found in this workspace's graph.`);
        }
        const node_type = node.node_type ?? "";
        const node_name = nameOf(node.properties);
        const names = { ...(node_name ? { node_name } : {}), ...(node_type ? { node_type } : {}) };
        if (MIRROR_OWNED_TYPES.has(node_type)) {
          return refuse(
            from_ref_id ?? "",
            names,
            `"${node_type}" is a mirror-owned type — its links would be silently restored by the next sync pass.`,
          );
        }

        // 2. Where it sits now: the edge to remove.
        const incoming = await listIncomingEdges(config, { ref_id, edge_type });
        if (!incoming.success) {
          return { error: incoming.message ?? "Could not read the node's links from the workspace's graph." };
        }
        let from: { ref_id: string; name?: string; edge_ref_id: string };
        if (from_ref_id) {
          const match = incoming.edges.find((e) => e.source_ref_id === from_ref_id);
          if (match) {
            from = { ref_id: from_ref_id, name: match.source_name, edge_ref_id: match.ref_id };
          } else {
            // The node's own listing can be cut short on a hub: look the one edge up by its ends.
            const found = await findEdgeByEndpoints(config, { source_ref_id: from_ref_id, edge_type, target_ref_id: ref_id });
            if (!found.success) {
              return { error: found.message ?? "Could not read the edge from the workspace's graph." };
            }
            if (!found.edge) {
              return refuse(from_ref_id, names, `"${ref_id}" is not under "${from_ref_id}" along ${edge_type}.`);
            }
            from = { ref_id: from_ref_id, name: found.edge.source_name, edge_ref_id: found.edge.ref_id };
          }
        } else if (incoming.edges.length === 1) {
          const [e] = incoming.edges;
          from = { ref_id: e.source_ref_id, name: e.source_name, edge_ref_id: e.ref_id };
        } else if (incoming.edges.length === 0) {
          return refuse(
            "",
            names,
            `"${ref_id}" has no ${edge_type} parent to move it from — use propose_create_triplet to link it under "${to_ref_id}".`,
          );
        } else {
          const parents = incoming.edges.map((e) => e.source_name ?? e.source_ref_id).join(", ");
          return refuse(
            "",
            names,
            `"${ref_id}" has ${incoming.edges.length} ${edge_type} parents (${parents}) — pass from_ref_id to say which link to move.`,
          );
        }
        const fromMeta = { ...names, ...(from.name ? { from_name: from.name } : {}), edge_ref_id: from.edge_ref_id };
        if (from.ref_id === to_ref_id) {
          return refuse(from.ref_id, fromMeta, `"${ref_id}" is already under "${to_ref_id}".`);
        }

        // 3. The destination: must exist, and must not sit under the node itself.
        const to = await readNodeByRef(config, to_ref_id);
        if (!to.success) {
          return refuse(from.ref_id, fromMeta, `Destination "${to_ref_id}" was not found in this workspace's graph.`);
        }
        const to_name = nameOf(to.properties);
        const meta = { ...fromMeta, ...(to_name ? { to_name } : {}) };
        if (await wouldCycle(config, { ref_id, to_ref_id, edge_type })) {
          return refuse(
            from.ref_id,
            meta,
            `"${to_ref_id}" sits under "${ref_id}" — moving the node there would make a cycle.`,
          );
        }

        return {
          kind: "graphNodeMove" as const,
          proposalId: nanoid(),
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            ref_id,
            edge_type,
            from_ref_id: from.ref_id,
            to_ref_id,
          } satisfies GraphNodeMoveProposalPayload,
          ...(rationale ? { rationale } : {}),
          meta: { workspaceSlug: verifiedSlug, ...meta },
        };
      },
    }),

    // ── propose_delete_node ───────────────────────────────────────────────

    [PROPOSE_DELETE_NODE_TOOL]: tool({
      description:
        "Propose soft-deleting a single node from the workspace knowledge graph. " +
        "Jarvis marks the node deleted and hard-deletes its edges in the same namespace " +
        "(edges to other namespaces or to system nodes are kept). " +
        "Refused for a node that can't be found, is already deleted, is a sync-owned or " +
        "code-graph type, or is an ingested node Jarvis can't yet delete safely. " +
        "Emits an approvable card showing the node's name, type and edges, with a warning " +
        "that those edges will be permanently deleted — nothing happens until the user clicks Approve.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe("Slug of the workspace the node belongs to."),
        ref_id: z.string().min(1).describe("ref_id of the node to delete."),
        rationale: z
          .string()
          .optional()
          .describe("Why this node should be removed."),
      }),
      execute: async ({ workspaceSlug, ref_id, rationale }) => {
        // 1. ref_id shape — before anything is read or written.
        if (!isSafeRefId(ref_id)) {
          return { error: "Not a valid node id." };
        }

        const resolved = await resolveGraphJarvis(orgId, userId, {
          slug: workspaceSlug,
        });
        if (!resolved.ok) return { error: resolved.error };
        const { workspaceId, workspaceSlug: verifiedSlug } = resolved.access;

        const refuse = (refusedReason: string, meta: Partial<DeleteMeta> = {}) => ({
          kind: "graphNodeDelete" as const,
          proposalId: nanoid(),
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            ref_id,
          } satisfies GraphNodeDeleteProposalPayload,
          meta: { workspaceSlug: verifiedSlug, ...meta, refusedReason },
        });

        // 2. The summary runs first — never readNodeByRef, which hides
        //    soft-deleted nodes and would turn "already deleted" into
        //    "not found".
        const summary = await readNodeDeleteSummary(verifiedSlug, userId, ref_id);
        if (!summary.ok) {
          if (summary.reason === "not_found") {
            return refuse('Not found, or not a node Jarvis can delete.');
          }
          if (summary.reason === "ambiguous") {
            return refuse("That id matches more than one node.");
          }
          return { error: "Couldn't read the node right now." };
        }

        const { labels, name, is_deleted, unique_source_id, edges, edge_total, kept_edges } = summary.summary;

        // 3. Already deleted.
        if (is_deleted) {
          return refuse("This node has already been deleted.", { node_name: name });
        }

        // 4. Domain type — no fallback. No domain label means "not found."
        const node_type = typeFromLabels(labels, "");
        if (!node_type) {
          return refuse('Not found, or not a node Jarvis can delete.');
        }
        const baseMeta: Partial<DeleteMeta> = { node_name: name, node_type };

        // 5. Sync-owned or code-graph types — by resolved type OR any label.
        const owned = (t: string) => MIRROR_OWNED_TYPES.has(t) || CODE_GRAPH_OWNED_TYPES.has(t);
        if (owned(node_type) || labels.some(owned)) {
          return refuse(
            `"${node_type}" is owned by a sync job — deleting it here would be merged back or duplicated on the next pass.`,
            baseMeta,
          );
        }

        // 6. Ingested nodes — guarded until every swarm runs the single-node delete.
        if (unique_source_id && !ALLOW_UNIQUE_SOURCE_ID_DELETE) {
          return refuse("Jarvis can't safely delete ingested nodes yet.", baseMeta);
        }

        // 7. Emit the card.
        return {
          kind: "graphNodeDelete" as const,
          proposalId: nanoid(),
          payload: {
            workspaceId,
            workspaceSlug: verifiedSlug,
            ref_id,
          } satisfies GraphNodeDeleteProposalPayload,
          ...(rationale ? { rationale } : {}),
          meta: {
            workspaceSlug: verifiedSlug,
            ...baseMeta,
            edges,
            edge_total,
            kept_edges,
          },
        };
      },
    }),
  };
}
