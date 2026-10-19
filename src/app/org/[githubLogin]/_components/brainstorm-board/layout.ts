import { layoutTree, estimateNodeHeight } from "../artifacts/viewers/ChoiceTree";
import { isPerson, ZONES, zonesOf, type BoardTree, type Zone } from "./zones";

export const CARD_W = 260;
export const ZONE_GAP = 240;
export const ZONE_PAD = 80;
/** Room above the cards for a zone's heading. */
export const HEADING_H = 130;

const lines = (t: string, per: number) => Math.max(1, Math.ceil(t.length / per));

/** Rendered height of a card: the shared estimate for the text, plus the board's own chrome. */
export function boardCardHeight(c: BoardTree["items"][number]): number {
  const base = estimateNodeHeight({ name: c.name, isQuestion: c.isQuestion }, false);
  const textLines = lines(c.name, c.isQuestion ? 26 : 28);
  if (isPerson(c.madeBy)) {
    const quote = c.quote ? lines(c.quote, 30) * 20 : 0;
    return Math.max(base, 78 + textLines * 24 + quote);
  }
  const rows = [c.reversibility, c.criteria, c.state].filter(Boolean).length;
  const criteria = c.criteria ? lines(c.criteria, 26) * 14 : 0;
  return 96 + textLines * 26 + rows * 24 + criteria;
}

export interface ZoneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  empty: boolean;
}

export interface BoardLayout {
  positions: Record<string, { x: number; y: number }>;
  heights: Record<string, number>;
  zones: Record<Zone, ZoneBox>;
  zoneOf: Map<string, Zone>;
}

/** Dagre per zone (left to right, as the chat card), the zones side by side with a gap. */
export function layoutBoard(tree: BoardTree): BoardLayout {
  const zoneOf = zonesOf(tree);
  const heights = Object.fromEntries(tree.items.map((i) => [i.id, boardCardHeight(i)]));
  const positions: BoardLayout["positions"] = {};
  const zones = {} as BoardLayout["zones"];
  let cursor = 0;
  for (const zone of ZONES) {
    const ids = tree.items.filter((i) => zoneOf.get(i.id) === zone).map((i) => i.id);
    const inZone = new Set(ids);
    const local = layoutTree(
      ids,
      tree.links.filter((l) => inZone.has(l.source) && inZone.has(l.target)),
      heights,
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      minX = Math.min(minX, local[id].x);
      minY = Math.min(minY, local[id].y);
      maxX = Math.max(maxX, local[id].x + CARD_W);
      maxY = Math.max(maxY, local[id].y + heights[id]);
    }
    if (!ids.length) {
      minX = 0;
      minY = 0;
      maxX = CARD_W;
      maxY = 200;
    }
    for (const id of ids) positions[id] = { x: local[id].x - minX + cursor, y: local[id].y - minY };
    zones[zone] = { x: cursor, y: 0, width: maxX - minX, height: maxY - minY, empty: !ids.length };
    cursor += maxX - minX + ZONE_GAP;
  }
  return { positions, heights, zones, zoneOf };
}
