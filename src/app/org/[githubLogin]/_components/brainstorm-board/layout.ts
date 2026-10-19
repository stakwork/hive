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
  if (!selected) return h;
  if (c.quote) h += lines(c.quote, person ? 28 : 26) * 21 + 8;
  h += 52; // state / criteria rows
  if (c.criteria) h += lines(c.criteria, 26) * 16;
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
export function layoutBoard(tree: BoardTree, selectedId: string | null = null, measured: Record<string, number> = {}): BoardLayout {
  const heights = Object.fromEntries(tree.items.map((i) => [i.id, measured[i.id] ?? boardCardHeight(i, i.id === selectedId)]));
  const positions = layoutTree(
    tree.items.map((i) => i.id),
    tree.links,
    heights,
    { nodesep: NODE_SEP, ranksep: RANK_SEP },
  );
  return { positions, heights };
}
