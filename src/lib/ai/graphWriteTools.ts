/**
 * Graph-write tools for Jamie (the canvas agent).
 *
 * Exposes four `propose_*` tools that emit approvable proposal cards
 * without performing any Jarvis writes. The write only happens after
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
import { readNodeByRef } from "@/services/swarm/api/nodes";
import { kgGetOntology } from "@/lib/ai/kg-adapter";
import { findReservedKeys } from "@/lib/proposals/graphWriteValidation";
import {
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
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
        "Reserved attribute keys (status, is_deleted, boost, ref_id, algo_*) are rejected. " +
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
            "Node attributes. Reserved keys (status, is_deleted, boost, ref_id, algo_*) are rejected.",
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
  };
}
