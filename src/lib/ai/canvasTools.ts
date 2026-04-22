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
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { buildCategoryDescription } from "@/app/org/[githubLogin]/connections/canvas-categories";

/**
 * Canvas tools for the Connections-page agent.
 *
 * The agent operates on the ORG ROOT canvas only (sub-canvases are a
 * follow-up). Three tools in increasing granularity:
 *
 *   1. `read_canvas`   — inspect current state; always called first so the
 *                        agent can preserve user edits on a re-generation.
 *   2. `update_canvas` — replace the whole canvas (nodes + edges). The
 *                        "lay out the problem" tool.
 *   3. `patch_canvas`  — apply a sequence of small ops (add/update/remove
 *                        node/edge). The "tick this box" tool.
 *
 * All writes go through the same `persistCanvas` helper so the root-row
 * sentinel, Pusher notification, and JSON validation stay in one place.
 */

/** Sentinel used for the root canvas row; mirrors the REST route. */
const ROOT_REF = "";

// ---------------------------------------------------------------------------
// Persistence + notification helpers
// ---------------------------------------------------------------------------

async function loadRootCanvas(orgId: string): Promise<CanvasData> {
  const row = await db.canvas.findUnique({
    where: { orgId_ref: { orgId, ref: ROOT_REF } },
  });
  if (!row) return { nodes: [], edges: [] };
  // Data was inserted as a validated CanvasData-shaped JSON; re-assert the
  // type here so downstream helpers get a typed value.
  return (row.data ?? { nodes: [], edges: [] }) as unknown as CanvasData;
}

async function persistRootCanvas(
  orgId: string,
  data: CanvasData,
): Promise<void> {
  const jsonData = data as unknown as Prisma.InputJsonValue;
  await db.canvas.upsert({
    where: { orgId_ref: { orgId, ref: ROOT_REF } },
    update: { data: jsonData },
    create: { orgId, ref: ROOT_REF, data: jsonData },
  });
}

/**
 * Delay before firing the Pusher trigger. On a brand-new page the client
 * lazily opens its Pusher WebSocket the first time `getPusherClient()`
 * runs, and `channel.subscribe()` resolves BEFORE the server confirms the
 * subscription. Events published during that window are dropped silently
 * (non-presence channels don't replay). Giving the client a short head
 * start makes first-canvas updates reliably land live instead of only on
 * refresh. 300ms is invisible to users (the agent has just finished a
 * multi-second reasoning turn) but comfortably longer than the typical
 * handshake.
 */
const CANVAS_NOTIFY_DELAY_MS = 300;

async function notifyCanvasUpdated(
  orgId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    if (!org) {
      console.warn(
        "[canvasTools] notifyCanvasUpdated: no SourceControlOrg for orgId",
        orgId,
      );
      return;
    }
    const channelName = getOrgChannelName(org.githubLogin);
    await new Promise((r) => setTimeout(r, CANVAS_NOTIFY_DELAY_MS));
    await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_UPDATED, {
      ref: null, // null == root canvas, mirrors the API's ROOT_REF sentinel
      action,
      ...(detail ?? {}),
      timestamp: Date.now(),
    });
    console.log(
      `[canvasTools] CANVAS_UPDATED → ${channelName} (${action})`,
      detail ?? {},
    );
  } catch (e) {
    console.error("[canvasTools] failed to send canvas update:", e);
  }
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

const customDataSchema = z
  .object({
    /**
     * Objective status — drives the pill (OK/ATTN/RISK), top-edge accent,
     * and progress-bar tint. Defaults to "ok" when omitted.
     */
    status: z.enum(["ok", "attn", "risk"]).optional(),
    /** Progress percent, e.g. "38%" or 0.38. Used by `objective`. */
    primary: z.union([z.string(), z.number()]).optional(),
    /** Footer text, e.g. "4 blockers" or "6 ppl". Used by `objective`. */
    secondary: z.string().optional(),
    /** When true, `secondary` is rendered in the status color (red/amber). */
    secondaryAccent: z.boolean().optional(),
    /** Blocker-tab badge number. Used by `objective`. */
    count: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .optional();

const nodeInputSchema = z.object({
  /**
   * Stable identifier. Omit on creation — we generate one. Supply only
   * when you want to re-use an id from `read_canvas` (e.g. to preserve a
   * node across an `update_canvas` regeneration).
   */
  id: z.string().optional(),
  type: z.literal("text").default("text"),
  category: z.string().describe(CATEGORY_DESCRIPTION),
  text: z.string().describe("Visible label. Use \\n for multi-line (objective)."),
  x: z.number().describe("Canvas-space x (pixels). See prompt for layout guide."),
  y: z.number().describe("Canvas-space y (pixels). See prompt for layout guide."),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
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
 */
function compactNode(n: CanvasNode) {
  const out: Record<string, unknown> = {
    id: n.id,
    category: n.category,
    text: n.text,
    x: n.x,
    y: n.y,
  };
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

export function buildCanvasTools(orgId: string): ToolSet {
  return {
    read_canvas: tool({
      description:
        "Read the current org canvas (nodes + edges). Call this FIRST " +
        "whenever you're about to modify the canvas — you need to see " +
        "what the user has already built or edited so you can preserve " +
        "their work.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const canvas = await loadRootCanvas(orgId);
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
        "Replace the entire org canvas with a new set of nodes and edges. " +
        "Use this when you're laying out (or re-laying out) a problem " +
        "from scratch. IMPORTANT: call read_canvas first and echo back " +
        "every node the user has already edited (recognizable by ids you " +
        "didn't just invent) so you don't clobber their work. For small " +
        "updates, prefer `patch_canvas`.",
      inputSchema: z.object({
        nodes: z.array(nodeInputSchema),
        edges: z.array(edgeInputSchema).default([]),
      }),
      execute: async ({ nodes, edges }) => {
        try {
          const canvas: CanvasData = {
            nodes: nodes.map(toCanvasNode),
            edges: edges.map(toCanvasEdge),
          };
          await persistRootCanvas(orgId, canvas);
          await notifyCanvasUpdated(orgId, "replaced", {
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
        "Apply one or more small ops (add/update/remove node/edge) to the " +
        "org canvas. Use this for targeted changes like 'mark initiative " +
        "X as at-risk' or 'add a blocker count'. Each op is applied in " +
        "order; if one fails, later ops in the same call still run.",
      inputSchema: z.object({
        ops: z.array(patchOpSchema).min(1),
      }),
      execute: async ({ ops }) => {
        try {
          let canvas = await loadRootCanvas(orgId);
          const applied: string[] = [];
          for (const op of ops as PatchOp[]) {
            canvas = applyPatchOp(canvas, op);
            applied.push(op.op);
          }
          await persistRootCanvas(orgId, canvas);
          await notifyCanvasUpdated(orgId, "patched", { ops: applied });
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
