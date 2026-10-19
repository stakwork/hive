/**
 * Where each brainstorm sits on the desk: one column per workspace under a
 * handwritten heading, its brainstorms stacked newest first. A brainstorm
 * opened by double-clicking the desk stays where it was opened for the
 * session (nothing is stored). Pure, no React.
 */

export interface DeskBlock {
  key: string;
  ws: string;
  width: number;
  height: number;
  /** Top-left where the person opened it, this session. */
  anchor?: { x: number; y: number };
}

export interface DeskPlacement {
  /** Top-left of each block. */
  offsets: Record<string, { x: number; y: number }>;
  /** Each workspace column's heading, top-left. */
  headings: Array<{ ws: string; x: number; y: number; count: number }>;
  /** Each column's x range, for "which workspace is this point in". */
  columns: Array<{ ws: string; x0: number; x1: number }>;
}

/** Space between brainstorms in a column. */
export const STACK_GAP = 200;
/** Space between workspace columns. */
export const COLUMN_GAP = 420;
/** The heading sits this far above a column's first brainstorm. */
export const HEADING_ABOVE = 260;
/** A column is at least this wide, so a lone small tree still reads as a column. */
export const MIN_COLUMN = 900;

export function placeDesk(blocks: DeskBlock[], wsOrder: string[]): DeskPlacement {
  const offsets: DeskPlacement["offsets"] = {};
  const headings: DeskPlacement["headings"] = [];
  const columns: DeskPlacement["columns"] = [];
  const order = [...new Set([...wsOrder, ...blocks.map((b) => b.ws)])];
  let x = 0;
  for (const ws of order) {
    const stack = blocks.filter((b) => b.ws === ws && !b.anchor);
    if (!stack.length) continue;
    let y = 0;
    let width = MIN_COLUMN;
    for (const b of stack) {
      offsets[b.key] = { x, y };
      y += b.height + STACK_GAP;
      width = Math.max(width, b.width);
    }
    headings.push({ ws, x, y: -HEADING_ABOVE, count: stack.length });
    columns.push({ ws, x0: x, x1: x + width });
    x += width + COLUMN_GAP;
  }
  for (const b of blocks) if (b.anchor) offsets[b.key] = b.anchor;
  return { offsets, headings, columns };
}

/** The workspace whose column is under (or nearest to) `x`; the first one when there are none. */
export function workspaceAt(placement: DeskPlacement, x: number, fallback: string): string {
  let best: { ws: string; d: number } | null = null;
  for (const c of placement.columns) {
    const d = x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0;
    if (!best || d < best.d) best = { ws: c.ws, d };
  }
  return best?.ws ?? fallback;
}
