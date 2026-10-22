import { layoutTree } from "../artifacts/viewers/ChoiceTree";
import { isPerson, type BoardTree } from "./model";

/** Every card is this wide; its text wraps inside. */
export const CARD_W = 260;
/** Vertical gap between cards of one column, and horizontal gap between columns. */
export const NODE_SEP = 44;
export const RANK_SEP = 110;

const lines = (t: string, per: number) => Math.max(1, Math.ceil(t.length / per));

type Item = BoardTree["items"][number];

/**
 * Height of a card before the DOM has been measured: a rough count of wrapped
 * lines, so the first layout is close. The board re-lays out with the real
 * sizes as soon as the cards report them.
 */
export function boardCardHeight(c: Item, selected: boolean): number {
  const person = isPerson(c.madeBy);
  const text = lines(`${c.letter ?? ""} ${c.name}`, person ? (c.isQuestion ? 20 : 24) : 25) * (person ? 25 : 20);
  let h = person ? 52 + text : 58 + text;
  const effects = c.isQuestion ? undefined : c.effects;
  if (!selected) return effects?.length ? h + 22 : h;
  if (c.quote) h += lines(c.quote, person ? 28 : 26) * 21 + 8;
  h += 52; // state / criteria rows
  if (c.criteria) h += lines(c.criteria, 26) * 16;
  if (effects?.length) {
    // Heading per list, then a name line and the wrapped description per effect.
    const perLine = person ? 26 : 28;
    for (const dir of ["pro", "con"] as const) {
      const list = effects.filter((e) => e.direction === dir);
      if (list.length) h += 24 + list.reduce((a, e) => a + 20 + (e.description ? lines(e.description, perLine) * 18 : 0) + 6, 0);
    }
  }
  return h + 44; // action buttons
}

export interface BoardLayout {
  positions: Record<string, { x: number; y: number }>;
  heights: Record<string, number>;
}

/**
 * One left-to-right tree from the root, ordered as the chat card orders it
 * (`buildChoiceTree`'s item order, dagre). `measured` heights, when known,
 * replace the estimates.
 */
export function layoutBoard(
  tree: BoardTree,
  selectedId: string | null = null,
  measured: Record<string, number> = {},
  prev: Record<string, { x: number; y: number }> = {},
  /** Ids that are never remembered (slots, the draft): they always take their fresh place. */
  transient: (id: string) => boolean = () => false,
): BoardLayout {
  const heights = Object.fromEntries(tree.items.map((i) => [i.id, measured[i.id] ?? boardCardHeight(i, i.id === selectedId)]));
  const fresh = layoutTree(
    tree.items.map((i) => i.id),
    tree.links,
    heights,
    { nodesep: NODE_SEP, ranksep: RANK_SEP },
  );
  return { positions: keepPlaced(tree, fresh, prev, transient), heights };
}

/**
 * A card already placed keeps its place, so selecting, expanding or answering
 * never moves what is on the board. A new card takes its fresh place shifted
 * by how far its parent was moved from the fresh layout, so it sits beside
 * its siblings and next to its parent. Parents come before children in
 * `tree.items`. With nothing placed yet this is the fresh layout.
 */
export function keepPlaced(
  tree: BoardTree,
  fresh: Record<string, { x: number; y: number }>,
  prev: Record<string, { x: number; y: number }>,
  transient: (id: string) => boolean = () => false,
): Record<string, { x: number; y: number }> {
  const parent = new Map(tree.links.map((l) => [l.target, l.source]));
  const out: Record<string, { x: number; y: number }> = {};
  for (const { id } of tree.items) {
    const old = transient(id) ? undefined : prev[id];
    if (old) {
      out[id] = old;
      continue;
    }
    const p = parent.get(id);
    const shift = p && out[p] && fresh[p] ? { x: out[p].x - fresh[p].x, y: out[p].y - fresh[p].y } : { x: 0, y: 0 };
    out[id] = { x: fresh[id].x + shift.x, y: fresh[id].y + shift.y };
  }
  return out;
}
