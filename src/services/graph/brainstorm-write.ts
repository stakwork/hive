/**
 * People's own edits to a brainstorm tree, written straight to the
 * workspace graph (the save route on the brainstorm desk). Agents never call
 * this: the strut job only adds proposals, and a state change — choose,
 * unchoose, reject, reopen, remove — is always a person's.
 *
 * A save is a batch of ops against one tree. `planBrainstormSave` checks the
 * batch against the tree as it is now and turns it into graph writes (pure,
 * no I/O); `saveBrainstormChanges` reads the tree, plans, and writes through
 * Jarvis (or the mock store), then nudges every open desk.
 *
 * The fields match what the strut brainstorm workflow writes (`question_id`
 * / `option_id`, `text`, `made_by`, `state`, soft-delete `deleted_at` /
 * `is_deleted` / `removed_*`), plus who did it and when.
 */

import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { notifyBrainstormUpdated } from "@/lib/pusher";
import { isRunGraphRefId } from "@/lib/strut-run-graph/hydrate";
import { addEdgeV2, addNode, updateNodeV2, type JarvisEdgeEndpoint } from "@/services/swarm/api/nodes";
import { mockBrainstormWrite } from "@/app/api/mock/graph/brainstorm-store";
import { getChoiceTree, type ChoiceTreeData } from "./workbench";

export const MAX_OPS = 50;
export const MAX_TEXT = 2000;
export const MAX_REASON = 500;

/** A card created earlier in the same batch, by the id the client gave it. */
const TEMP_RE = /^[A-Za-z0-9_-]{1,40}$/;

export type StateOp = "choose" | "unchoose" | "reject" | "reopen";

export type BrainstormOp =
  | { op: "add_question"; temp: string; parent: string | null; text: string }
  | { op: "add_option"; temp: string; parent: string; text: string }
  | { op: "edit_text"; ref: string; text: string }
  | { op: StateOp; ref: string; reason?: string }
  | { op: "remove"; ref: string; reason?: string }
  | { op: "link"; ref: string; edge: "ABOUT" | "BUILDS_ON"; target: string };

export interface BrainstormSave {
  /** The tree's root ref_id; null when the batch starts a new brainstorm (its first op is `add_question` with no parent). */
  root: string | null;
  ops: BrainstormOp[];
  /** Each card's `state` and `state_at` as the client last saw them; a mismatch refuses the whole save. */
  expected?: Record<string, { state: string; state_at: number | null }>;
}

export interface Actor {
  id: string;
  login: string | null;
  name: string | null;
}

/** Where the person acted: the desk, or Jamie's chat on their word. */
export type SaveSource = "board" | "chat";

type Endpoint = { ref: string } | { temp: string };
type NodeType = "Question" | "Option";

export interface PlannedCreate {
  temp: string;
  nodeType: NodeType;
  data: Record<string, unknown>;
  parent: Endpoint | null;
}

export interface SavePlan {
  creates: PlannedCreate[];
  /** Property patches for nodes already in the graph, one per node. */
  patches: Record<string, Record<string, unknown>>;
  links: Array<{ edgeType: "ABOUT" | "BUILDS_ON"; source: Endpoint; target: string }>;
}

export type PlanResult =
  | { ok: true; plan: SavePlan }
  | { ok: false; status: 400; message: string }
  | { ok: false; status: 409; message: string; conflicts: string[] };

let counter = 0;

/**
 * A new `question_id` / `option_id`: globally unique, never a path label.
 * It starts with the epoch ms, like the workflow's ids start with their run
 * id (also epoch ms), so siblings sort in the order they were written.
 */
export function newChoiceId(now = Date.now()): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${String(now).padStart(13, "0")}-hive-${String(counter).padStart(6, "0")}-${rand}`;
}

interface Card {
  type: NodeType;
  props: Record<string, unknown>;
  parent: string | null;
}

const bad = (message: string): PlanResult => ({ ok: false, status: 400, message });
const stateOf = (props: Record<string, unknown>) => (typeof props.state === "string" ? props.state : "open");
const textOf = (props: Record<string, unknown>) =>
  typeof props.text === "string" ? props.text : typeof props.name === "string" ? props.name : "";

/** A legacy `Choice` reads as a question when its `kind` says so, else an option. */
function cardType(node: ChoiceTreeData["nodes"][number]): NodeType {
  if (node.type === "Choice") return node.properties.kind === "question" ? "Question" : "Option";
  return node.type;
}

/**
 * Checks `save` against `tree` (null for a new brainstorm) and turns it into
 * graph writes. Ops apply in order, each seeing the ones before it, so a new
 * box and its options — or a new option and choosing it — save in one batch.
 */
export function planBrainstormSave(
  tree: ChoiceTreeData | null,
  save: BrainstormSave,
  actor: Actor,
  source: SaveSource,
  now = Date.now(),
): PlanResult {
  const { ops } = save;
  if (!ops.length) return bad("Nothing to save.");
  if (ops.length > MAX_OPS) return bad(`At most ${MAX_OPS} changes per save.`);

  // The working view: every card, as the batch has left it so far.
  const cards = new Map<string, Card>();
  const kids = new Map<string, string[]>();
  const temps = new Set<string>();
  const removed = new Set<string>();
  if (tree) {
    for (const n of tree.nodes) cards.set(n.ref_id, { type: cardType(n), props: { ...n.properties }, parent: null });
    for (const e of tree.edges) {
      const child = cards.get(e.target);
      if (child && child.parent === null) child.parent = e.source;
      kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
    }
  }

  const conflicts = Object.entries(save.expected ?? {}).filter(([ref, seen]) => {
    const card = cards.get(ref);
    if (!card) return true;
    const at = typeof card.props.state_at === "number" ? card.props.state_at : null;
    return stateOf(card.props) !== seen.state || at !== seen.state_at;
  });
  if (conflicts.length) {
    return {
      ok: false,
      status: 409,
      message: "Someone changed this brainstorm since you loaded it.",
      conflicts: conflicts.map(([ref]) => ref),
    };
  }

  const plan: SavePlan = { creates: [], patches: {}, links: [] };
  const by = { actor_id: actor.id, actor_login: actor.login };
  const stamp = (reason: string) => ({
    state_by_id: actor.id,
    state_by_login: actor.login,
    state_at: now,
    state_reason: reason.slice(0, MAX_REASON),
    state_source: source,
  });
  /** Records a property change on a card: into its create when it is new in this batch, else into its patch. */
  const patch = (id: string, data: Record<string, unknown>) => {
    const card = cards.get(id)!;
    Object.assign(card.props, data);
    const create = plan.creates.find((c) => c.temp === id);
    if (create) Object.assign(create.data, data);
    else plan.patches[id] = { ...plan.patches[id], ...data };
  };
  const live = (id: string) => cards.has(id) && !removed.has(id);
  const endpoint = (id: string): Endpoint => (temps.has(id) ? { temp: id } : { ref: id });
  const chosenSiblings = (option: string) => {
    const parent = cards.get(option)?.parent;
    return (parent ? (kids.get(parent) ?? []) : []).filter(
      (s) => s !== option && live(s) && cards.get(s)!.type === "Option" && stateOf(cards.get(s)!.props) === "chosen",
    );
  };
  /** Reopens an option's question once none of its options is chosen. */
  const reopenQuestionIfNoneChosen = (option: string, reason: string) => {
    const parent = cards.get(option)?.parent;
    if (parent && live(parent) && stateOf(cards.get(parent)!.props) === "decided" && !chosenSiblings(option).length) {
      patch(parent, { state: "open", ...stamp(reason) });
    }
  };

  for (const [i, op] of ops.entries()) {
    const at = `Change ${i + 1}`;
    if (op.op === "add_question" || op.op === "add_option") {
      if (!TEMP_RE.test(op.temp) || cards.has(op.temp)) return bad(`${at}: the new card needs its own id.`);
      const text = op.text.trim();
      if (!text) return bad(`${at}: write something on the card first.`);
      if (text.length > MAX_TEXT) return bad(`${at}: keep a card under ${MAX_TEXT} characters.`);
      const nodeType: NodeType = op.op === "add_question" ? "Question" : "Option";
      if (op.parent === null) {
        // Only a new brainstorm's first card has no parent.
        if (op.op !== "add_question" || save.root !== null || i !== 0)
          return bad(`${at}: a new card goes under a card on this brainstorm.`);
      } else {
        if (!live(op.parent)) return bad(`${at}: the card you added under is no longer on this brainstorm.`);
        if (nodeType === "Option" && cards.get(op.parent)!.type !== "Question")
          return bad(`${at}: options go under a question.`);
      }
      const data: Record<string, unknown> = {
        [nodeType === "Question" ? "question_id" : "option_id"]: newChoiceId(now),
        ...(nodeType === "Option" && { kind: "option" }),
        text,
        made_by: "user",
        ...(actor.name || actor.login ? { speaker: actor.name ?? actor.login } : {}),
        ...by,
        created_at: now,
        state: "open",
      };
      temps.add(op.temp);
      cards.set(op.temp, { type: nodeType, props: { ...data }, parent: op.parent });
      if (op.parent) kids.set(op.parent, [...(kids.get(op.parent) ?? []), op.temp]);
      plan.creates.push({ temp: op.temp, nodeType, data, parent: op.parent === null ? null : endpoint(op.parent) });
      continue;
    }

    if (!live(op.ref)) return bad(`${at}: that card is no longer on this brainstorm.`);
    const card = cards.get(op.ref)!;
    const state = stateOf(card.props);
    const quoted = `"${textOf(card.props).slice(0, 80)}"`;
    const reason = (fallback: string) => ("reason" in op && op.reason?.trim()) || fallback;

    switch (op.op) {
      case "edit_text": {
        const text = op.text.trim();
        if (!text) return bad(`${at}: a card can't be empty.`);
        if (text.length > MAX_TEXT) return bad(`${at}: keep a card under ${MAX_TEXT} characters.`);
        patch(op.ref, { text, edited_by_id: actor.id, edited_by_login: actor.login, edited_at: now });
        break;
      }
      case "choose": {
        if (card.type !== "Option") return bad(`${at}: only an option can be chosen.`);
        if (state === "chosen") break;
        // Several options of one question can be chosen: choosing leaves the others as they are.
        patch(op.ref, {
          state: "chosen",
          ...stamp(reason(source === "board" ? "chosen on the board" : "asked in chat")),
        });
        if (card.parent && live(card.parent) && stateOf(cards.get(card.parent)!.props) !== "decided") {
          patch(card.parent, { state: "decided", ...stamp(`option ${quoted} chosen`) });
        }
        break;
      }
      case "unchoose": {
        if (card.type !== "Option" || state !== "chosen") return bad(`${at}: only a chosen option can be deselected.`);
        patch(op.ref, { state: "open", ...stamp(reason("deselected")) });
        reopenQuestionIfNoneChosen(op.ref, `option ${quoted} deselected`);
        break;
      }
      case "reject": {
        if (card.type !== "Option") return bad(`${at}: only an option can be dropped.`);
        if (state === "rejected") break;
        patch(op.ref, { state: "rejected", ...stamp(reason("dropped")) });
        if (state === "chosen") reopenQuestionIfNoneChosen(op.ref, `chosen option ${quoted} dropped`);
        break;
      }
      case "reopen": {
        const reopenable = card.type === "Option" ? state === "rejected" || state === "simulated" : state === "decided";
        if (!reopenable) break;
        patch(op.ref, { state: "open", ...stamp(reason("reopened")) });
        break;
      }
      case "remove": {
        if (save.root !== null && op.ref === save.root)
          return bad(`${at}: the top question can't be removed from here.`);
        if (temps.has(op.ref)) return bad(`${at}: discard an unsaved card instead of removing it.`);
        // Soft delete, like the workflow's remove: the card and everything under it, edges kept so it can be undone.
        const gone = [op.ref];
        for (let k = 0; k < gone.length; k++)
          for (const c of kids.get(gone[k]) ?? []) if (live(c) && !gone.includes(c)) gone.push(c);
        for (const id of gone) {
          if (temps.has(id)) return bad(`${at}: save or discard the new cards under it first.`);
          patch(id, {
            deleted_at: now,
            is_deleted: true,
            removed_reason: reason("removed").slice(0, MAX_REASON),
            removed_by_id: actor.id,
            removed_root: save.root,
          });
          removed.add(id);
        }
        break;
      }
      case "link": {
        if (card.type !== "Question") return bad(`${at}: only a question can be linked.`);
        if (!isRunGraphRefId(op.target) || op.target === op.ref) return bad(`${at}: link it to another card.`);
        plan.links.push({ edgeType: op.edge, source: endpoint(op.ref), target: op.target });
        break;
      }
    }
  }
  return { ok: true, plan };
}

export type SaveResult =
  | { ok: true; data: { root: string; created: Record<string, string> } }
  | { ok: false; status: number; message: string; conflicts?: string[]; tree?: ChoiceTreeData };

interface Caller {
  slug: string;
  userId: string;
}

/** Applies a plan through Jarvis; a card whose parent link fails is soft-deleted again, so no orphan is left behind. */
async function writePlan(
  config: { jarvisUrl: string; apiKey: string },
  plan: SavePlan,
  now: number,
): Promise<
  { ok: true; created: Record<string, string> } | { ok: false; message: string; created: Record<string, string> }
> {
  const created: Record<string, string> = {};
  const ref = (e: Endpoint): JarvisEdgeEndpoint => ({ ref_id: "ref" in e ? e.ref : created[e.temp] });
  for (const c of plan.creates) {
    const res = await addNode(config, { node_type: c.nodeType, node_data: c.data });
    // A fresh id that "already exists" is a clash, never a merge.
    if (!res.success || !res.ref_id || res.alreadyExists)
      return { ok: false, message: res.error ?? "The graph didn't take the new card.", created };
    if (c.parent) {
      const edge = await addEdgeV2(config, {
        edge: { edge_type: "PARENT_OF" },
        source: ref(c.parent),
        target: { ref_id: res.ref_id },
      });
      if (!edge.success) {
        await updateNodeV2(config, res.ref_id, { deleted_at: now, is_deleted: true, removed_reason: "save failed" });
        return { ok: false, message: edge.message ?? "The graph didn't link the new card.", created };
      }
    }
    created[c.temp] = res.ref_id;
  }
  for (const [id, data] of Object.entries(plan.patches)) {
    const res = await updateNodeV2(config, id, data);
    if (!res.success) return { ok: false, message: res.message ?? "The graph didn't take a change.", created };
  }
  for (const l of plan.links) {
    const res = await addEdgeV2(config, {
      edge: { edge_type: l.edgeType },
      source: ref(l.source),
      target: { ref_id: l.target },
    });
    if (!res.success) return { ok: false, message: res.message ?? "The graph didn't take the link.", created };
  }
  return { ok: true, created };
}

/**
 * Saves a person's batch of edits to one brainstorm. The caller must already
 * have checked the person may write in the workspace (DEVELOPER and above);
 * `resolveGraphJarvis` checks it again before any write.
 */
export async function saveBrainstormChanges(
  caller: Caller,
  save: BrainstormSave,
  source: SaveSource = "board",
): Promise<SaveResult> {
  if (save.root !== null && !isRunGraphRefId(save.root)) return { ok: false, status: 400, message: "Invalid root" };

  const [workspace, user] = await Promise.all([
    db.workspace.findFirst({
      where: { slug: caller.slug, deleted: false },
      select: { sourceControlOrgId: true, sourceControlOrg: { select: { githubLogin: true } } },
    }),
    db.user.findUnique({
      where: { id: caller.userId },
      select: { name: true, githubAuth: { select: { githubUsername: true } } },
    }),
  ]);
  if (!workspace?.sourceControlOrgId)
    return { ok: false, status: 404, message: "Workspace not found or access denied." };
  const actor: Actor = { id: caller.userId, login: user?.githubAuth?.githubUsername ?? null, name: user?.name ?? null };

  let tree: ChoiceTreeData | null = null;
  if (save.root !== null) {
    const read = await getChoiceTree(caller, save.root);
    if (!read.ok) return { ok: false, status: read.status, message: read.message };
    if (!read.data.nodes.some((n) => n.ref_id === save.root))
      return { ok: false, status: 404, message: "That brainstorm is no longer in the graph." };
    tree = read.data;
  }

  const now = Date.now();
  const planned = planBrainstormSave(tree, save, actor, source, now);
  if (!planned.ok) return planned.status === 409 ? { ...planned, tree: tree ?? undefined } : planned;

  let written: Awaited<ReturnType<typeof writePlan>>;
  if (process.env.USE_MOCKS === "true") {
    written = { ok: true, created: mockBrainstormWrite(planned.plan) };
  } else {
    const access = await resolveGraphJarvis(workspace.sourceControlOrgId, caller.userId, { slug: caller.slug });
    if (!access.ok) return { ok: false, status: 403, message: access.error };
    written = await writePlan(access.access.config, planned.plan, now);
  }

  const root = save.root ?? written.created[(save.ops[0] as { temp: string }).temp];
  const login = workspace.sourceControlOrg?.githubLogin;
  // Partly written is still written: tell the open desks either way.
  if (login && root) notifyBrainstormUpdated(login, { workspaceSlug: caller.slug, root });
  if (!written.ok) return { ok: false, status: 502, message: written.message };
  return { ok: true, data: { root, created: written.created } };
}
