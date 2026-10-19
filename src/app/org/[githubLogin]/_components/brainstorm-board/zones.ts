import type { buildChoiceTree, ChoiceItem } from "../artifacts/viewers/ChoiceTree";

/**
 * Pure helpers of the brainstorm board: which zone a node sits in, which
 * branches are ghosts, the chosen path. No React, no DOM.
 */

export type BoardTree = ReturnType<typeof buildChoiceTree>;
export type Zone = "built" | "now" | "could";
export const ZONES: readonly Zone[] = ["built", "now", "could"];

/** A person wrote it: any `made_by` other than "model" (a real login or id may replace "user" later). */
export const isPerson = (madeBy: string | undefined | null): boolean => madeBy !== "model";

interface Index {
  byId: Map<string, ChoiceItem>;
  parent: Map<string, string>;
  kids: Map<string, string[]>;
}

const indexes = new WeakMap<BoardTree, Index>();

/** Parent / children lookups for a tree, built once per tree object. */
export function indexOf(tree: BoardTree): Index {
  let idx = indexes.get(tree);
  if (!idx) {
    const byId = new Map(tree.items.map((i) => [i.id, i]));
    const parent = new Map<string, string>();
    const kids = new Map<string, string[]>();
    for (const l of tree.links) {
      parent.set(l.target, l.source);
      kids.set(l.source, [...(kids.get(l.source) ?? []), l.target]);
    }
    idx = { byId, parent, kids };
    indexes.set(tree, idx);
  }
  return idx;
}

const isOption = (n: ChoiceItem) => !n.isQuestion;
const decidedQuestion = (n: ChoiceItem | undefined) => !!n && n.isQuestion && n.state === "decided";

/** True when the node or any ancestor is simulated. */
function underSimulation(id: string, idx: Index): boolean {
  for (let cur: string | undefined = id; cur; cur = idx.parent.get(cur)) {
    if (idx.byId.get(cur)?.state === "simulated") return true;
  }
  return false;
}

/** A decided question with every ancestor a decided question or a chosen option. */
function onChosenPath(id: string, idx: Index): boolean {
  for (let cur: string | undefined = idx.parent.get(id); cur; cur = idx.parent.get(cur)) {
    const n = idx.byId.get(cur);
    if (!n) return false;
    if (!(decidedQuestion(n) || (isOption(n) && n.state === "chosen"))) return false;
  }
  return true;
}

/**
 * Descendants of the options a decided question did not choose: the
 * branches that were never taken, drawn faded. (The unchosen options
 * themselves are not ghosts — they dim.)
 */
export function ghostIds(tree: BoardTree): Set<string> {
  const idx = indexOf(tree);
  const out = new Set<string>();
  const add = (id: string) => {
    for (const k of idx.kids.get(id) ?? []) {
      if (out.has(k)) continue;
      out.add(k);
      add(k);
    }
  };
  for (const n of tree.items) {
    if (!isOption(n) || n.state === "chosen") continue;
    if (decidedQuestion(idx.byId.get(idx.parent.get(n.id) ?? ""))) add(n.id);
  }
  return out;
}

/** Options a decided question did not choose, while a sibling was: they stay beside the decision, dimmed. */
export function dimmedIds(tree: BoardTree): Set<string> {
  const idx = indexOf(tree);
  const out = new Set<string>();
  for (const n of tree.items) {
    if (!isOption(n) || n.state === "chosen") continue;
    const p = idx.parent.get(n.id);
    if (!decidedQuestion(idx.byId.get(p ?? ""))) continue;
    if ((idx.kids.get(p!) ?? []).some((s) => idx.byId.get(s)?.state === "chosen" && isOption(idx.byId.get(s)!))) out.add(n.id);
  }
  return out;
}

/**
 * Which zone a node sits in.
 * v1 assumption, see plan: an Option `chosen` under a `decided` Question (and
 * decided questions on the chosen path) is built; `simulated` nodes and
 * everything under them could be; everything else is now. Branches that
 * were not taken (dimmed siblings and their ghost descendants) stay in the
 * zone of the decision they lost to.
 */
export function zoneOf(node: Pick<ChoiceItem, "id">, tree: BoardTree): Zone {
  const idx = indexOf(tree);
  const n = idx.byId.get(node.id);
  if (!n) return "now";
  if (underSimulation(n.id, idx)) return "could";
  if (isOption(n) && n.state === "chosen" && decidedQuestion(idx.byId.get(idx.parent.get(n.id) ?? ""))) return "built";
  if (decidedQuestion(n) && onChosenPath(n.id, idx)) return "built";
  if (dimmedIds(tree).has(n.id) || ghostIds(tree).has(n.id)) return "built";
  return "now";
}

/** Zone of every item, in one pass. */
export function zonesOf(tree: BoardTree): Map<string, Zone> {
  return new Map(tree.items.map((i) => [i.id, zoneOf(i, tree)]));
}

/** The chosen chain from the root, ending at the first open question (or where the chain stops). */
export function myPath(tree: BoardTree): string[] {
  const idx = indexOf(tree);
  const root = tree.items[0];
  if (!root) return [];
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: ChoiceItem | undefined = root;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur.id);
    if (cur.isQuestion && cur.state !== "decided") break;
    const kids: ChoiceItem[] = (idx.kids.get(cur.id) ?? []).map((k) => idx.byId.get(k)!).filter(Boolean);
    cur = cur.isQuestion ? (kids.find((k) => isOption(k) && k.state === "chosen") ?? kids.find((k) => k.isQuestion)) : kids.find((k) => k.isQuestion);
  }
  return path;
}

/** Whether a could-be node hangs off the chosen path: its topmost simulated ancestor's parent is on it. */
export function couldOnMyPath(id: string, tree: BoardTree, path: ReadonlySet<string>): boolean {
  const idx = indexOf(tree);
  let top = id;
  for (let cur: string | undefined = id; cur; cur = idx.parent.get(cur)) {
    if (idx.byId.get(cur)?.state === "simulated") top = cur;
  }
  const p = idx.parent.get(top);
  return !p || path.has(p);
}

/** The text a signature shows: the speaker, else made_by unless it is the generic "user", else "someone". */
export function authorName(n: Pick<ChoiceItem, "speaker" | "madeBy">): string {
  return n.speaker ?? (n.madeBy && n.madeBy !== "user" ? n.madeBy : "someone");
}

export interface BoardMember {
  id: string;
  name: string | null;
  image: string | null;
  githubUsername: string | null;
}

/** The org member a node's speaker or made_by names — by id, githubUsername or name, case-insensitive. */
export function matchMember(members: readonly BoardMember[], n: Pick<ChoiceItem, "speaker" | "madeBy">): BoardMember | null {
  const keys = [n.speaker, n.madeBy].filter((k): k is string => !!k).map((k) => k.toLowerCase());
  if (!keys.length) return null;
  return (
    members.find((m) => [m.id, m.githubUsername, m.name].some((v) => v && keys.includes(v.toLowerCase()))) ?? null
  );
}
