import { tool, ToolSet } from "ai";
import { z } from "zod";
import type {
  CanvasData,
  CanvasEdge,
  CanvasNode,
  EdgeUpdate,
  NodeUpdate,
} from "system-canvas";
import {
  addEdge,
  addNode,
  generateEdgeId,
  generateNodeId,
  removeEdge,
  removeNode,
  updateEdge,
  updateNode,
} from "system-canvas";
import { buildCategoryDescription } from "@/app/org/[githubLogin]/connections/canvas-categories";
import {
  notifyCanvasUpdated,
  readCanvas,
  ROOT_REF,
  writeCanvas,
} from "@/lib/canvas";

/**
 * Canvas tools for the org canvas agent (default `/org/[githubLogin]`
 * route). The system prompt threads the user's current canvas scope
 * + selected node into the agent so tool calls default to the right
 * `ref`; see `getCanvasScopeHint` in `@/lib/constants/prompt`.
 *
 * Three tools in increasing granularity:
 *
 *   1. `read_canvas`   — inspect current state; always called first so the
 *                        agent can preserve user edits on a re-generation.
 *   2. `update_canvas` — replace the whole canvas (nodes + edges). The
 *                        "lay out the problem" tool.
 *   3. `patch_canvas`  — apply a sequence of small ops (add/update/remove
 *                        node/edge). The "tick this box" tool.
 *
 * Each tool takes an optional `ref` (defaults to the root canvas, `""`).
 * All persistence goes through `readCanvas` / `writeCanvas` in
 * `@/lib/canvas`, which handle the authored-vs-live split. Pusher
 * notifications are fired afterwards so open clients refetch and
 * re-render the merged canvas.
 */

// ---------------------------------------------------------------------------
// Persistence + notification helpers
// ---------------------------------------------------------------------------

/**
 * Load the merged canvas at `(orgId, ref)`. Returns the same view the
 * REST `GET` returns — live nodes projected, rollups applied, edges
 * filtered to intact endpoints.
 */
async function loadCanvas(orgId: string, ref: string): Promise<CanvasData> {
  return readCanvas(orgId, ref);
}

/**
 * Persist a canvas at `(orgId, ref)`. The write helper splits the
 * incoming merged document into an authored-only blob before it hits
 * the DB, so DB-owned fields on live nodes (text, category,
 * customData) are silently discarded.
 */
async function persistCanvas(
  orgId: string,
  ref: string,
  data: CanvasData,
): Promise<void> {
  await writeCanvas(orgId, ref, data);
}

// ---------------------------------------------------------------------------
// Zod schemas shared between update_canvas and patch_canvas
// ---------------------------------------------------------------------------

/**
 * The category vocabulary the renderer understands. Generated from
 * `canvas-categories.ts` so the tool schema and the prompt can never
 * drift from the renderer. The Zod type is `z.string()` rather than an
 * enum so the agent can experiment with future categories without
 * tool-call failures; the renderer treats unknown categories as plain
 * boxes.
 */
const CATEGORY_DESCRIPTION = buildCategoryDescription();

/**
 * Free-form `customData` bag. The agent only authors `note` and
 * `decision` nodes today — neither uses structured customData. Projected
 * categories (`initiative`, `milestone`, etc.) DO consume customData,
 * but those are populated by the projector, not the agent. We accept
 * any shape here so the agent can round-trip projected nodes through
 * `update_canvas` without losing data; the server's splitter then
 * discards customData on live ids and keeps it on authored ones.
 */
const customDataSchema = z.object({}).passthrough().optional();

const nodeInputSchema = z.object({
  /**
   * Stable identifier. Omit on creation — we generate one. Supply only
   * when you want to re-use an id from `read_canvas` (e.g. to preserve a
   * node across an `update_canvas` regeneration or to echo back a
   * projected live node).
   */
  id: z.string().optional(),
  type: z.literal("text").default("text"),
  category: z.string().describe(CATEGORY_DESCRIPTION),
  text: z.string().describe("Visible label. Use \\n for multi-line where the renderer supports it."),
  x: z.number().describe("Canvas-space x (pixels). See prompt for layout guide."),
  y: z.number().describe("Canvas-space y (pixels). See prompt for layout guide."),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /**
   * Optional sub-canvas ref. Projected live nodes carry one so users
   * can zoom into them; the agent should echo it back unchanged when
   * round-tripping through `update_canvas`.
   */
  ref: z.string().optional(),
  customData: customDataSchema,
});

const edgeInputSchema = z.object({
  id: z.string().optional(),
  fromNode: z.string().describe("Source node id"),
  toNode: z.string().describe("Target node id"),
  label: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Compact read representation
// ---------------------------------------------------------------------------

/**
 * Trim internal/derived fields so the LLM sees a small, stable shape.
 * Whatever we include here is also the contract the agent should use when
 * round-tripping through `update_canvas`.
 *
 * `ref` is preserved on live nodes (`ws:…`, `feature:…`) so the agent
 * can tell at a glance which nodes are projected from the DB — those
 * ids have the `<kind>:` prefix, and the `ref` field points to their
 * drill-down sub-canvas.
 */
function compactNode(n: CanvasNode) {
  const out: Record<string, unknown> = {
    id: n.id,
    category: n.category,
    text: n.text,
    x: n.x,
    y: n.y,
  };
  if (n.ref) out.ref = n.ref;
  if (n.width != null) out.width = n.width;
  if (n.height != null) out.height = n.height;
  if (n.customData && Object.keys(n.customData).length > 0) {
    out.customData = n.customData;
  }
  return out;
}

function compactEdge(e: CanvasEdge) {
  const out: Record<string, unknown> = {
    id: e.id,
    fromNode: e.fromNode,
    toNode: e.toNode,
  };
  if (e.label) out.label = e.label;
  return out;
}

// ---------------------------------------------------------------------------
// Patch op application — one helper per op. Each takes the current canvas
// and returns the next one, using the system-canvas core mutators.
// ---------------------------------------------------------------------------

type AddNodeOp = { op: "add_node"; node: z.infer<typeof nodeInputSchema> };
type UpdateNodeOp = {
  op: "update_node";
  id: string;
  patch: z.infer<typeof nodeInputSchema>["customData"] extends infer _T
    ? Partial<z.infer<typeof nodeInputSchema>>
    : never;
};
type RemoveNodeOp = { op: "remove_node"; id: string };
type AddEdgeOp = { op: "add_edge"; edge: z.infer<typeof edgeInputSchema> };
type UpdateEdgeOp = {
  op: "update_edge";
  id: string;
  patch: Partial<z.infer<typeof edgeInputSchema>>;
};
type RemoveEdgeOp = { op: "remove_edge"; id: string };

type PatchOp =
  | AddNodeOp
  | UpdateNodeOp
  | RemoveNodeOp
  | AddEdgeOp
  | UpdateEdgeOp
  | RemoveEdgeOp;

const patchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: nodeInputSchema }),
  z.object({
    op: z.literal("update_node"),
    id: z.string(),
    patch: nodeInputSchema.partial(),
  }),
  z.object({ op: z.literal("remove_node"), id: z.string() }),
  z.object({ op: z.literal("add_edge"), edge: edgeInputSchema }),
  z.object({
    op: z.literal("update_edge"),
    id: z.string(),
    patch: edgeInputSchema.partial(),
  }),
  z.object({ op: z.literal("remove_edge"), id: z.string() }),
]);

function toCanvasNode(input: z.infer<typeof nodeInputSchema>): CanvasNode {
  const id = input.id ?? generateNodeId();
  const node: CanvasNode = {
    id,
    type: "text",
    x: input.x,
    y: input.y,
    category: input.category,
    text: input.text,
  };
  if (input.width != null) node.width = input.width;
  if (input.height != null) node.height = input.height;
  if (input.ref) node.ref = input.ref;
  if (input.customData) {
    node.customData = input.customData as Record<string, unknown>;
  }
  return node;
}

function toCanvasEdge(input: z.infer<typeof edgeInputSchema>): CanvasEdge {
  const id = input.id ?? generateEdgeId();
  const edge: CanvasEdge = {
    id,
    fromNode: input.fromNode,
    toNode: input.toNode,
  };
  if (input.label) edge.label = input.label;
  return edge;
}

function applyPatchOp(canvas: CanvasData, op: PatchOp): CanvasData {
  switch (op.op) {
    case "add_node":
      return addNode(canvas, toCanvasNode(op.node));
    case "update_node": {
      // Split the free-form patch into a system-canvas-shaped NodeUpdate.
      // We can't just pass the object through because `op.patch.type` is
      // absent-vs-"text" in our schema, and NodeUpdate omits `type`.
      const { id: _ignored, type: _t, ...rest } = op.patch;
      const patch = rest as NodeUpdate;
      // Shallow-merge customData so the agent can set one field without
      // nuking the others (common on "mark 3 blockers" style edits).
      if (patch.customData) {
        const existing = canvas.nodes?.find((n) => n.id === op.id);
        if (existing?.customData) {
          patch.customData = { ...existing.customData, ...patch.customData };
        }
      }
      return updateNode(canvas, op.id, patch);
    }
    case "remove_node":
      return removeNode(canvas, op.id);
    case "add_edge":
      return addEdge(canvas, toCanvasEdge(op.edge));
    case "update_edge": {
      const { id: _ignored, ...rest } = op.patch;
      return updateEdge(canvas, op.id, rest as EdgeUpdate);
    }
    case "remove_edge":
      return removeEdge(canvas, op.id);
  }
}

// ---------------------------------------------------------------------------
// Public: build the toolset
// ---------------------------------------------------------------------------

/**
 * Shared `ref` argument. Optional; defaults to the root canvas. Sub-
 * canvases use the same id/ref convention as the REST API: `""` for
 * root, `node:<id>` for an authored-node zoom, `ws:<cuid>` / `feature:
 * <cuid>` for entity deep-dives.
 */
const REF_DESCRIPTION =
  'Canvas scope. Omit (or pass "") for the org root canvas. Pass a ' +
  'sub-canvas ref (e.g. "node:<id>" to zoom into an authored node) ' +
  "to address a different canvas.";

export function buildCanvasTools(orgId: string): ToolSet {
  return {
    read_canvas: tool({
      description:
        "Read the current canvas (nodes + edges). Call this FIRST " +
        "whenever you're about to modify the canvas — you need to see " +
        "what the user has already built or edited so you can preserve " +
        "their work. Returns authored nodes AND projected live nodes " +
        "(ids prefixed with `ws:`, `feature:`, etc.) merged into one " +
        "array; you don't need to distinguish them for reads.",
      inputSchema: z.object({
        ref: z.string().describe(REF_DESCRIPTION).optional(),
      }),
      execute: async ({ ref }) => {
        try {
          const scopeRef = ref ?? ROOT_REF;
          const canvas = await loadCanvas(orgId, scopeRef);
          const nodes = (canvas.nodes ?? []).map(compactNode);
          const edges = (canvas.edges ?? []).map(compactEdge);
          return { nodes, edges };
        } catch (e) {
          console.error("[canvasTools.read_canvas] error:", e);
          return { error: "Failed to read canvas" };
        }
      },
    }),

    update_canvas: tool({
      description:
        "Replace the entire canvas with a new set of nodes and edges. " +
        "Use this when you're laying out (or re-laying out) a problem " +
        "from scratch. IMPORTANT: call read_canvas first and echo back " +
        "every node the user has already edited (recognizable by ids " +
        "you didn't just invent) AND every projected live node " +
        "(prefixed `ws:`, `feature:`, …) so you don't clobber their " +
        "work. For small updates, prefer `patch_canvas`.",
      inputSchema: z.object({
        ref: z.string().describe(REF_DESCRIPTION).optional(),
        nodes: z.array(nodeInputSchema),
        edges: z.array(edgeInputSchema).default([]),
      }),
      execute: async ({ ref, nodes, edges }) => {
        try {
          const scopeRef = ref ?? ROOT_REF;
          const canvas: CanvasData = {
            nodes: nodes.map(toCanvasNode),
            edges: edges.map(toCanvasEdge),
          };
          await persistCanvas(orgId, scopeRef, canvas);
          await notifyCanvasUpdated(orgId, scopeRef, "replaced", {
            nodeCount: canvas.nodes?.length ?? 0,
            edgeCount: canvas.edges?.length ?? 0,
          });
          return {
            status: "updated",
            nodeCount: canvas.nodes?.length ?? 0,
            edgeCount: canvas.edges?.length ?? 0,
          };
        } catch (e) {
          console.error("[canvasTools.update_canvas] error:", e);
          return { error: "Failed to update canvas" };
        }
      },
    }),

    patch_canvas: tool({
      description:
        "Apply one or more small ops (add/update/remove node/edge) to a " +
        "canvas. Use this for targeted changes like 'add a note explaining " +
        "milestone M' or 'edge initiative A to workspace W'. Each op is " +
        "applied in order; if one fails, later ops in the same call still run.",
      inputSchema: z.object({
        ref: z.string().describe(REF_DESCRIPTION).optional(),
        ops: z.array(patchOpSchema).min(1),
      }),
      execute: async ({ ref, ops }) => {
        try {
          const scopeRef = ref ?? ROOT_REF;
          let canvas = await loadCanvas(orgId, scopeRef);
          const applied: string[] = [];
          for (const op of ops as PatchOp[]) {
            canvas = applyPatchOp(canvas, op);
            applied.push(op.op);
          }
          await persistCanvas(orgId, scopeRef, canvas);
          await notifyCanvasUpdated(orgId, scopeRef, "patched", { ops: applied });
          return {
            status: "patched",
            appliedOps: applied,
            nodeCount: canvas.nodes?.length ?? 0,
            edgeCount: canvas.edges?.length ?? 0,
          };
        } catch (e) {
          console.error("[canvasTools.patch_canvas] error:", e);
          return { error: "Failed to patch canvas" };
        }
      },
    }),
  };
}
