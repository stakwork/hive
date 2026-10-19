import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";

/** Search across the desk's cards. Pure, no React. */

export interface SearchEntry {
  item: ChoiceItem;
  /** The brainstorm it belongs to. */
  key: string;
  ws: string;
  /** That brainstorm's question. */
  board: string;
}

export const STATE_WORD: Record<string, string> = {
  open: "open",
  chosen: "chosen",
  decided: "decided",
  rejected: "dropped",
  simulated: "could be",
};
/** Decisions first: what was chosen or decided is usually what you're looking for. */
export const rank = (i: ChoiceItem) => (i.state === "chosen" || i.state === "decided" ? 0 : i.state === "open" ? 1 : 2);
const MAX_RESULTS = 12;

/** Every card on the desk whose text has `query` in it, decisions first. */
export function searchDesk(entries: SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries
    .filter((e) => e.item.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a.item) - rank(b.item))
    .slice(0, MAX_RESULTS);
}
