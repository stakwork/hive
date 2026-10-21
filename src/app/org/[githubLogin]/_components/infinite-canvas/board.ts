/**
 * The infinite canvas's model: the org's initiatives as one board, read from
 * the graph, problem before solution (Jarvis 133–135). An initiative holds
 * the why and the journeys: HiveInitiative -HAS_BRIEF-> Brief, -HAS_STORY->
 * UserStory -HAS_REQUIREMENT-> Requirement. It breaks into -HAS_MILESTONE->
 * HiveMilestone (by `sequence`); a milestone holds features
 * (-HAS_FEATURE-> InitiativeFeature), each with an architecture
 * (-HAS_ARCHITECTURE->); a feature's build is its strut jobs (`build.ts`). A brainstorm hangs off any of the three
 * (Question -ABOUT-> node); an expanded answer raises its own Question, and
 * choosing an answer makes the level below (Option -RESULTED_IN-> node, here
 * the node's `madeBy`). Pure: no React.
 */

import { makesList } from "@/lib/initiative-plan";
import { compareChoiceIds } from "../artifacts/viewers/ChoiceTree";
import type {
  ChoiceTreeData,
  InitiativeSummary,
  InitiativeTreeData,
  InitiativeTreeNode,
} from "@/services/graph/workbench";

/** Who wrote it: a person's words are handwritten, everything else typeset. */
export type Author = "person" | "strut";
export type NodeType = "initiative" | "brief" | "milestone" | "feature" | "story" | "requirement" | "question";
/** Where the build is (`build.ts`): a feature reads its jobs; a milestone its features; an initiative its milestones. */
export type WorkState = "not-started" | "in-progress" | "done" | "blocked";

/** An answer weighed against one of the plan's requirements. */
export interface Pro {
  /** The requirement it's weighed against, when the effect names one. */
  req: string | null;
  good: boolean;
  text: string;
}

export interface Option {
  id: string;
  letter: string;
  title: string;
  author: Author;
  /** 1–3 on each corner it was rated on. */
  fast?: number;
  good?: number;
  cheap?: number;
  pros: Pro[];
  /** What choosing it makes one level down (strut's `makes`); unset makes one, named after the answer; empty makes nothing. */
  makes?: string[];
  chosen: boolean;
  rejected: boolean;
}

export interface PlanNode {
  /** The graph ref_id. */
  id: string;
  /** The workspace whose graph holds it. */
  ws: string;
  type: NodeType;
  /** The HAS_* edge into this node. */
  parent?: string;
  /** Questions: the initiative, milestone or feature the brainstorm is about. */
  about?: string;
  /** Questions: the answer this is a follow-up to. */
  follows?: string;
  /** Questions: the root of their brainstorm tree, which saves go to. */
  root?: string;
  name: string;
  author: Author;
  /** The node's own `status`, as the graph has it. */
  status?: string;
  sequence?: number;
  options?: Option[];
  decided?: boolean;
  /** The answers whose choice made it (`Option -RESULTED_IN->`). */
  madeBy?: string[];
  /** Feature: how it's built. */
  architecture?: { name: string; description: string; diagram?: string };
  /** Initiative: when anything in it last changed, ms. The desk shows the latest. */
  updatedAt?: number;
}

export interface Board {
  nodes: PlanNode[];
}

export interface InitiativeEntry {
  summary: InitiativeSummary;
  ws: string;
  tree?: InitiativeTreeData;
}

const TYPES: Record<string, NodeType> = {
  HiveInitiative: "initiative",
  Brief: "brief",
  HiveMilestone: "milestone",
  InitiativeFeature: "feature",
  UserStory: "story",
  Requirement: "requirement",
  Question: "question",
};
/** A card's kind as its graph label. */
export const GRAPH_LABEL = Object.fromEntries(Object.entries(TYPES).map(([label, t]) => [t, label])) as Record<
  NodeType,
  string
>;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
/** A person wrote it when the graph says human (or a person's brainstorm card); strut, Jamie and unmarked nodes are typeset. */
const authorOf = (p: Record<string, unknown>): Author =>
  p.created_by_kind === "human" || (p.made_by !== undefined && p.made_by !== "model") ? "person" : "strut";
/** A -1..1 rating as 1–3 pips. */
export const pips = (score: number | undefined) =>
  score === undefined ? undefined : Math.min(3, Math.max(1, Math.round(score + 2)));
const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

/** One brainstorm tree folded into questions with their answers, hung off `about`. */
export function brainstormNodes(tree: ChoiceTreeData, root: string, about: string, ws: string): PlanNode[] {
  const byId = new Map(tree.nodes.map((n) => [n.ref_id, n]));
  const kids = new Map<string, string[]>();
  for (const e of tree.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
  }
  const isQuestion = (id: string) => {
    const n = byId.get(id)!;
    return n.type === "Question" || n.properties.kind === "question";
  };
  const order = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const pa = byId.get(a)!.properties;
      const pb = byId.get(b)!.properties;
      return compareChoiceIds(
        pa.option_id ?? pa.choice_id ?? pa.question_id,
        pb.option_id ?? pb.choice_id ?? pb.question_id,
      );
    });
  const out: PlanNode[] = [];
  const seen = new Set<string>();
  const question = (id: string, follows?: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    const p = byId.get(id)!.properties;
    const children = order(kids.get(id) ?? []);
    const options: Option[] = children
      .filter((c) => !isQuestion(c))
      .map((c, i) => {
        const o = byId.get(c)!;
        const op = o.properties;
        const makes = makesList(op.makes);
        return {
          id: c,
          letter: letterOf(i),
          title: text(op.text) ?? text(op.name) ?? c,
          author: authorOf(op),
          fast: pips(o.ratings?.fast),
          good: pips(o.ratings?.good),
          cheap: pips(o.ratings?.cheap),
          pros: (o.effects ?? []).map((e) => ({
            req: e.against?.[0] ?? null,
            good: e.direction === "pro",
            text: e.name,
          })),
          ...(makes ? { makes } : {}),
          chosen: op.state === "chosen",
          rejected: op.state === "rejected",
        };
      });
    out.push({
      id,
      ws,
      type: "question",
      root,
      about,
      ...(follows ? { follows } : {}),
      name: text(p.text) ?? text(p.name) ?? id,
      author: authorOf(p),
      options,
      decided: p.state === "decided" || options.some((o) => o.chosen),
    });
    for (const c of children) {
      // A question under a question is another question on the same tree; under an answer, a follow-up to it.
      if (isQuestion(c)) question(c);
      else for (const f of order(kids.get(c) ?? []).filter(isQuestion)) question(f, c);
    }
  };
  question(root);
  return out;
}

/** A feature's architecture, from the node hanging off it. */
function architectureOf(tree: InitiativeTreeData, featureId: string) {
  const a = tree.edges
    .filter((e) => e.source === featureId)
    .map((e) => tree.nodes.find((n) => n.ref_id === e.target && n.type === "Architecture"))
    .find((n): n is InitiativeTreeNode => !!n)?.properties;
  return a
    ? {
        name: text(a.name) ?? "",
        description: text(a.description) ?? "",
        ...(text(a.diagram) ? { diagram: String(a.diagram) } : {}),
      }
    : undefined;
}

/** The board: every listed initiative with its tree (when read), and the brainstorm trees read so far. */
export function toBoard(entries: InitiativeEntry[], brainstorms: Record<string, ChoiceTreeData | undefined>): Board {
  const nodes: PlanNode[] = [];
  const seen = new Set<string>();
  for (const { summary, ws, tree } of entries) {
    if (seen.has(summary.ref_id)) continue;
    const updatedAt = summary.updated_at ?? summary.created_at ?? undefined;
    const graphNodes = tree?.nodes ?? [];
    const typeOf = new Map(graphNodes.map((n) => [n.ref_id, n.type]));
    const parentOf = new Map<string, string>();
    for (const e of tree?.edges ?? []) {
      if (parentOf.has(e.target)) continue;
      // A plan written before 135 hangs stories off features: they are still the initiative's journeys.
      const legacyStory = typeOf.get(e.target) === "UserStory" && typeOf.get(e.source) === "InitiativeFeature";
      parentOf.set(e.target, legacyStory ? summary.ref_id : e.source);
    }
    if (!graphNodes.some((n) => n.ref_id === summary.ref_id)) {
      seen.add(summary.ref_id);
      nodes.push({
        id: summary.ref_id,
        ws,
        type: "initiative",
        name: summary.name,
        author: summary.created_by_kind === "human" ? "person" : "strut",
        status: summary.status ?? undefined,
        updatedAt,
      });
    }
    for (const n of graphNodes) {
      const type = TYPES[n.type];
      if (!type || seen.has(n.ref_id)) continue;
      seen.add(n.ref_id);
      const p = n.properties;
      nodes.push({
        id: n.ref_id,
        ws,
        type,
        ...(n.ref_id !== summary.ref_id && parentOf.has(n.ref_id) ? { parent: parentOf.get(n.ref_id) } : {}),
        name:
          (type === "brief" || type === "story" || type === "requirement" ? text(p.text) : text(p.name)) ??
          text(p.name) ??
          text(p.title) ??
          "",
        author: authorOf(p),
        ...(text(p.status) ? { status: String(p.status) } : {}),
        ...(typeof p.sequence === "number" ? { sequence: p.sequence } : {}),
        ...(n.madeBy?.length ? { madeBy: n.madeBy } : {}),
        ...(type === "feature" && tree ? { architecture: architectureOf(tree, n.ref_id) } : {}),
        ...(type === "initiative" ? { updatedAt } : {}),
      });
      for (const root of n.brainstorms ?? []) {
        const t = brainstorms[root];
        if (t)
          for (const q of brainstormNodes(t, root, n.ref_id, ws)) if (!seen.has(q.id) && seen.add(q.id)) nodes.push(q);
      }
    }
  }
  return { nodes };
}

/**
 * A board's lookups, built once per board (boards are immutable: every read
 * makes a new one). The canvas renders every card on every camera frame, so
 * cards and children are found in a map, not by scanning.
 */
interface Index {
  byId: Map<string, PlanNode>;
  /** Children by HAS_* edges, in `sequence` order (then as the graph gave them). */
  kids: Map<string, PlanNode[]>;
}
const indexes = new WeakMap<Board, Index>();
function indexOf(b: Board): Index {
  let idx = indexes.get(b);
  if (!idx) {
    const kids = new Map<string, PlanNode[]>();
    for (const n of b.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
    for (const list of kids.values()) list.sort((x, y) => (x.sequence ?? Infinity) - (y.sequence ?? Infinity));
    idx = { byId: new Map(b.nodes.map((n) => [n.id, n])), kids };
    indexes.set(b, idx);
  }
  return idx;
}

export const byId = (b: Board, id: string) => indexOf(b).byId.get(id);

/** Every initiative, most recently updated first. */
export const initiativesByRecency = (b: Board) =>
  b.nodes.filter((n) => n.type === "initiative").sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));

/** How many initiatives the desk shows by default: the latest by `updated_at`. */
export const DESK_SIZE = 3;

/** Children by HAS_* edges, in `sequence` order (then as the graph gave them). */
export function kids(b: Board, id: string, type?: NodeType): PlanNode[] {
  const all = indexOf(b).kids.get(id) ?? [];
  return type ? all.filter((n) => n.type === type) : all;
}

/** A node's brainstorms: the questions at the root of each tree. */
export const brainstormsOn = (b: Board, id: string) =>
  b.nodes.filter((n) => n.type === "question" && n.about === id && !n.follows);

/** The question an expanded answer raised, if it's been expanded. */
export const followUpTo = (b: Board, optionId: string) =>
  b.nodes.find((n) => n.type === "question" && n.follows === optionId);

/** Every node under `id` by HAS_* edges, depth first. */
export function descendants(b: Board, id: string): PlanNode[] {
  return kids(b, id).flatMap((k) => [k, ...descendants(b, k.id)]);
}


/** The card a node hangs from: its HAS_* parent, the node a brainstorm is about, or the question an answer belongs to. */
export function upOf(b: Board, n: PlanNode): string | undefined {
  return (
    n.parent ?? n.about ?? (n.follows ? b.nodes.find((x) => x.options?.some((o) => o.id === n.follows))?.id : undefined)
  );
}

/** The node and every card above it, nearest first. */
export function ancestry(b: Board, id: string): PlanNode[] {
  const out: PlanNode[] = [];
  for (let cur = byId(b, id); cur && out.length < 16; cur = upOf(b, cur) ? byId(b, upOf(b, cur)!) : undefined)
    out.push(cur);
  return out;
}

/** The initiative a node belongs to. */
export const initiativeOf = (b: Board, id: string) => ancestry(b, id).find((n) => n.type === "initiative");

const CONTAINER_TYPES: NodeType[] = ["initiative", "milestone", "feature"];

/** The container (initiative, milestone, feature) a card sits in, or is: where its artifacts show. */
export const nearestContainer = (b: Board, id: string) =>
  ancestry(b, id).find((n) => CONTAINER_TYPES.includes(n.type))?.id;

/** "1 milestone", "3 milestones", "2 user stories". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The ask that starts a feature's build: a job whose pull requests show on the card. Offered once it has an architecture. */
export const IMPLEMENT = "Implement this feature.";

/** What the Ask Jamie box offers on a node, most useful first. */
export function suggestions(b: Board, id: string): string[] {
  const node = byId(b, id);
  if (!node) return [];
  switch (node.type) {
    case "initiative":
    case "brief": {
      const init = node.type === "brief" ? node.parent! : id;
      const stories = kids(b, init, "story").length;
      return [
        ...(stories ? [] : ["Write the user journeys and requirements for this initiative."]),
        ...(kids(b, init, "milestone").length ? [] : ["Break this initiative into milestones."]),
        brainstormsOn(b, init).length
          ? "Start another brainstorm on this initiative."
          : "Brainstorm how to stage this initiative.",
        ...(stories ? ["Add more user journeys to this initiative."] : []),
      ];
    }
    case "milestone":
      return [
        ...(kids(b, id, "feature").length ? [] : ["Propose features for this milestone."]),
        brainstormsOn(b, id).length
          ? "Start another brainstorm on this milestone."
          : "Brainstorm how to build this milestone.",
      ];
    case "feature":
      return [
        node.architecture ? IMPLEMENT : "Draft the architecture for this feature.",
        brainstormsOn(b, id).length
          ? "Start another brainstorm on this feature."
          : "Brainstorm how to build this feature.",
      ];
    case "story":
      return ["Add requirements to this story."];
    case "question":
      return ["Suggest another option."];
    default:
      return [];
  }
}

/** The graph property holding a card's words: a name for the containers, the text for the rest. */
export const textField = (type: NodeType): "name" | "text" =>
  type === "initiative" || type === "milestone" || type === "feature" ? "name" : "text";

export const SEARCHABLE: Array<{ type: NodeType; label: string }> = [
  { type: "initiative", label: "Initiatives" },
  { type: "milestone", label: "Milestones" },
  { type: "feature", label: "Features" },
  { type: "story", label: "User stories" },
  { type: "requirement", label: "Requirements" },
];

/** Names above a node: "Self-serve onboarding › Sign-up to first workspace". */
export function pathOf(b: Board, n: PlanNode): string[] {
  const p = n.parent ? byId(b, n.parent) : undefined;
  return p ? [...pathOf(b, p), p.name] : [];
}

/**
 * The best node for "pull up …": an exact name, then a name containing the
 * words, then most words matched; ties go to the bigger thing (initiative
 * before requirement).
 */
export function bestMatch(b: Board, query: string): PlanNode | undefined {
  const q = query
    .toLowerCase()
    .replace(/[.?!]+$/, "")
    .trim();
  const words = q.split(/\s+/).filter(Boolean);
  const rank = SEARCHABLE.map((g) => g.type);
  let best: { n: PlanNode; score: number } | undefined;
  for (const n of b.nodes) {
    if (!rank.includes(n.type)) continue;
    const name = n.name.toLowerCase();
    const score =
      (name === q ? 100 : name.includes(q) ? 50 : 0) +
      words.filter((w) => name.includes(w)).length * 5 -
      rank.indexOf(n.type);
    if (score > 4 && (!best || score > best.score)) best = { n, score };
  }
  return best?.n;
}

/** "pull up Repo picker", "open the janitor initiative", "take me to invite by link". */
export const NAVIGATE = /^(?:pull up|open|go to|show me|take me to|jump to)\s+(?:the\s+)?(.+)$/i;
