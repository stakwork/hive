/**
 * Canvas node extraction utility.
 *
 * Parses the raw JSON stored in `Canvas.data` and returns only the nodes
 * whose `category` is `"note"` or `"decision"`. Notes and Decisions are
 * not DB tables — they live exclusively inside the canvas JSON blob.
 *
 * Handles empty, null, and malformed blobs gracefully (returns []).
 */

import type { CanvasNoteRow } from "@/services/jarvis-mirror/mappers";

type CanvasCategory = "note" | "decision";
const CANVAS_CATEGORIES = new Set<string>(["note", "decision"]);

interface RawCanvasNode {
  id?: unknown;
  type?: unknown;
  category?: unknown;
  text?: unknown;
  x?: unknown;
  y?: unknown;
}

/**
 * Extract note and decision nodes from a raw Canvas.data blob.
 *
 * @param data  - The raw `Canvas.data` value (JSON from Prisma, may be anything).
 * @param canvasRef - The `Canvas.ref` this data came from (stored in node for provenance).
 * @returns     Normalized array of note/decision nodes; empty on any parse failure.
 */
export function extractCanvasNoteNodes(
  data: unknown,
  canvasRef: string,
): CanvasNoteRow[] {
  if (!data || typeof data !== "object") return [];

  // Canvas.data may be the full canvas state object ({ nodes: [...], edges: [...] })
  // or a flat array of nodes. Support both shapes.
  let rawNodes: unknown[];
  if (Array.isArray(data)) {
    rawNodes = data;
  } else {
    const obj = data as Record<string, unknown>;
    const nodesField = obj["nodes"];
    if (!Array.isArray(nodesField)) return [];
    rawNodes = nodesField;
  }

  const results: CanvasNoteRow[] = [];
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as RawCanvasNode;

    const category = typeof node.category === "string" ? node.category : null;
    if (!category || !CANVAS_CATEGORIES.has(category)) continue;

    const id = typeof node.id === "string" ? node.id : null;
    if (!id) continue;

    const text = typeof node.text === "string" ? node.text : "";
    const x = typeof node.x === "number" ? node.x : null;
    const y = typeof node.y === "number" ? node.y : null;

    results.push({
      id,
      text,
      category: category as CanvasCategory,
      x,
      y,
      canvasRef,
    });
  }
  return results;
}
