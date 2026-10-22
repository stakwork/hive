/**
 * Where each brainstorm sits on the desk: a timeline, left to right by day.
 * A brainstorm's time is the latest time any of its cards was added (or now,
 * when it has unsaved pencil), so a new branch pulls the whole tree toward
 * today. Trees are grouped by local calendar day: oldest day on the left,
 * today on the right, each under a small handwritten day label, its trees
 * stacked newest first. A day with no trees takes no space, and trees with no
 * time at all go far left. Workspaces play no part in the layout. A brainstorm
 * opened by double-clicking the desk stays where it was opened for the session
 * (nothing is stored). Pure, no React.
 */

export interface DeskBlock {
  key: string;
  ws: string;
  width: number;
  height: number;
  /** When the brainstorm was last added to, ms since epoch; none sorts it far left. */
  at?: number;
  /** Top-left where the person opened it, this session. */
  anchor?: { x: number; y: number };
}

export interface DeskPlacement {
  /** Top-left of each block. */
  offsets: Record<string, { x: number; y: number }>;
  /** Each day's label, top-left. `day` is the local date (YYYY-MM-DD), "" for undated. */
  headings: Array<{ day: string; title: string; x: number; y: number; count: number }>;
  /** Each day's x range. */
  columns: Array<{ day: string; x0: number; x1: number }>;
}

/** Space between brainstorms in a day. */
export const STACK_GAP = 200;
/** Space between days. */
export const COLUMN_GAP = 420;
/** The label sits this far above a day's first brainstorm. */
export const HEADING_ABOVE = 260;
/** A day is at least this wide. */
export const MIN_COLUMN = 500;

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Today", "Yesterday", else "Mon 13 Oct" (with the year when not this year). */
export function dayLabel(ms: number, now: number): string {
  const key = dayKey(ms);
  if (key === dayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y.getTime())) return "Yesterday";
  const d = new Date(ms);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function placeDesk(blocks: DeskBlock[], now: number = Date.now()): DeskPlacement {
  const offsets: DeskPlacement["offsets"] = {};
  const headings: DeskPlacement["headings"] = [];
  const columns: DeskPlacement["columns"] = [];
  const days = new Map<string, { at: number; stack: DeskBlock[] }>();
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.anchor || seen.has(b.key)) continue;
    seen.add(b.key);
    const day = b.at === undefined ? "" : dayKey(b.at);
    const d = days.get(day) ?? { at: b.at ?? 0, stack: [] };
    d.stack.push(b);
    days.set(day, d);
  }
  // Oldest first; undated ("") first of all. Within a day, newest first (stable on ties).
  const ordered = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let x = 0;
  for (const [day, { stack }] of ordered) {
    stack.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    let y = 0;
    let width = MIN_COLUMN;
    for (const b of stack) {
      offsets[b.key] = { x, y };
      y += b.height + STACK_GAP;
      width = Math.max(width, b.width);
    }
    const title = day ? dayLabel(stack[0].at!, now) : "Undated";
    headings.push({ day, title, x, y: -HEADING_ABOVE, count: stack.length });
    columns.push({ day, x0: x, x1: x + width });
    x += width + COLUMN_GAP;
  }
  for (const b of blocks) if (b.anchor && !offsets[b.key]) offsets[b.key] = b.anchor;
  return { offsets, headings, columns };
}

/** Epoch seconds or milliseconds (the live graph stores ms, older nodes seconds) to ms; undefined if not a positive number. */
export function graphEpochToMs(value: unknown): number | undefined {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return v > 1e12 ? v : v * 1000;
}

/**
 * Any graph time to ms: an ISO string, epoch ms (number or numeric string) or
 * legacy epoch seconds (float or numeric string). undefined when missing or
 * unparseable. Readers of `updated_at` / `created_at` use this so the stored
 * format can move from ISO to epoch ms without breaking them.
 */
export function graphTimeToMs(value: unknown): number | undefined {
  if (typeof value === "number") return graphEpochToMs(value);
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) return graphEpochToMs(t);
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The latest `date_added_to_graph` (epoch ms or seconds, number or numeric string) over a tree's cards, in ms. */
export function latestAdded(nodes: Array<{ properties?: Record<string, unknown> }> | undefined): number | undefined {
  let best: number | undefined;
  for (const n of nodes ?? []) {
    const ms = graphEpochToMs(n.properties?.date_added_to_graph);
    if (ms !== undefined && (best === undefined || ms > best)) best = ms;
  }
  return best;
}
