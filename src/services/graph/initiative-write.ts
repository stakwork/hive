/**
 * People's own edits to an initiative's plan on the canvas, written straight
 * to the graph (Jarvis ontology 133–135): rename an initiative, milestone or
 * feature, edit the brief, a story or a requirement, add a milestone, feature,
 * user story or requirement, accept or drop a requirement, set a milestone's
 * `sequence`, delete a story or requirement (soft delete), and choose an
 * answer in a brainstorm.
 *
 * The plan holds the problem before the solution: an initiative has the brief
 * and the user stories (with their requirements); milestones hold features;
 * a feature's build is the strut jobs started on it. Choosing an answer
 * makes the level below what the brainstorm is about (`Option -RESULTED_IN->`):
 * milestones under an initiative, features under a milestone.
 *
 * A save is a batch of ops against one initiative. `planInitiativeSave` checks
 * it against the tree as it is now and turns it into graph writes (pure, no
 * I/O); `planChoice` does the same for a choice; `saveInitiativeChanges` reads,
 * plans and writes through Jarvis (or the mock store). Every new node gets a
 * fresh UUID key and `created_*` provenance. `updated_at` is never sent: the
 * graph writer stamps it on every change.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { notifyInitiativeUpdated } from "@/lib/pusher";
import { makesList } from "@/lib/initiative-plan";
import { isRunGraphRefId } from "@/lib/strut-run-graph/hydrate";
import {
  addEdgeV2,
  addNode,
  updateNodeV2,
  type JarvisEdgeEndpoint,
} from "@/services/swarm/api/nodes";
import { mockInitiativeWrite } from "@/app/api/mock/graph/initiative-fixture";
import { saveBrainstormChanges, type BrainstormOp } from "./brainstorm-write";
import {
  getChoiceTree,
  getInitiativeTree,
  type ChoiceTreeData,
  type InitiativeNodeType,
  type InitiativeTreeData,
  type InitiativeTreeType,
} from "./workbench";

export const MAX_OPS = 50;
export const MAX_TEXT = 4000;
/** A choice makes at most this many nodes, whatever strut put in `makes`. */
export const MAX_MAKES = 12;

/** What a person may set on each type, and which of those a new node must have. */
const FIELDS: Record<InitiativeNodeType, { editable: string[]; required: string[]; key: string }> = {
  HiveInitiative: { editable: ["name", "description", "status"], required: ["name"], key: "initiative_id" },
  HiveMilestone: { editable: ["name", "description", "status", "sequence"], required: ["name"], key: "milestone_id" },
  Brief: { editable: ["title", "text", "status"], required: ["text"], key: "brief_id" },
  InitiativeFeature: { editable: ["name", "description", "status"], required: ["name"], key: "feature_id" },
  UserStory: { editable: ["text", "status"], required: ["text"], key: "story_id" },
  Requirement: { editable: ["text", "status"], required: ["text"], key: "requirement_id" },
};

/** Which parent each type hangs from, and by which edge. */
const PARENTS: Record<Exclude<InitiativeNodeType, "HiveInitiative">, Partial<Record<InitiativeNodeType, string>>> = {
  HiveMilestone: { HiveInitiative: "HAS_MILESTONE" },
  Brief: { HiveInitiative: "HAS_BRIEF" },
  // The problem lives on the initiative: its user stories, and their requirements.
  UserStory: { HiveInitiative: "HAS_STORY" },
  Requirement: { UserStory: "HAS_REQUIREMENT" },
  InitiativeFeature: { HiveMilestone: "HAS_FEATURE" },
};

/** Jarvis requires `status` on these; a new one starts proposed. */
const STARTS_PROPOSED: InitiativeNodeType[] = ["InitiativeFeature", "UserStory", "Requirement"];
export const REQUIREMENT_STATUSES = ["proposed", "accepted", "dropped"];

/** What a person may delete from the canvas: a story (and the requirements under it) or a requirement. */
export const REMOVABLE: InitiativeNodeType[] = ["UserStory", "Requirement"];

/** What choosing an answer makes, by what the brainstorm is about. A feature's answers make nothing: its build is its jobs. */
export const MAKES: Partial<Record<InitiativeTreeType, { type: InitiativeNodeType; edge: string }>> = {
  HiveInitiative: { type: "HiveMilestone", edge: "HAS_MILESTONE" },
  HiveMilestone: { type: "InitiativeFeature", edge: "HAS_FEATURE" },
};

export type Fields = Record<string, string | number>;

export type InitiativeOp =
  | { op: "add"; temp: string; type: InitiativeNodeType; parent: string | null; fields: Fields }
  | { op: "edit"; ref: string; fields: Fields }
  | { op: "remove"; ref: string }
  /**
   * Choose an answer in a brainstorm about this initiative or a node in it
   * (`chosen: false` takes the choice back). Alone in its batch. Saying what
   * the person wants, not toggling, keeps a retry safe.
   */
  | { op: "choose"; root: string; option: string; chosen: boolean };

export interface InitiativeSave {
  /** The initiative's ref_id; null when the batch creates one (its first op adds a `HiveInitiative`). */
  root: string | null;
  ops: InitiativeOp[];
}

type Endpoint = { ref: string } | { temp: string };

export interface InitiativePlan {
  creates: Array<{
    temp: string;
    nodeType: InitiativeNodeType;
    data: Record<string, unknown>;
    parent: Endpoint | null;
    edgeType: string | null;
  }>;
  /** Property patches for nodes already in the graph, one per node. */
  patches: Record<string, Record<string, unknown>>;
  /** Edges between nodes, beyond where a new node hangs: `RESULTED_IN`, `SATISFIES`. */
  links: Array<{ edgeType: string; source: Endpoint; target: Endpoint }>;
}

export type InitiativePlanResult = { ok: true; plan: InitiativePlan } | { ok: false; status: 400; message: string };

const bad = (message: string): { ok: false; status: 400; message: string } => ({ ok: false, status: 400, message });
const emptyPlan = (): InitiativePlan => ({ creates: [], patches: {}, links: [] });
const softDelete = (now: Date) => ({ deleted_at: now.getTime(), is_deleted: true });

function checkFields(type: InitiativeNodeType, fields: Fields): string | null {
  for (const [k, v] of Object.entries(fields)) {
    if (!FIELDS[type].editable.includes(k)) return `${type} has no editable field "${k}".`;
    if (k === "sequence" ? typeof v !== "number" || !Number.isInteger(v) : typeof v !== "string")
      return `"${k}" has the wrong type.`;
    if (typeof v === "string" && v.length > MAX_TEXT) return `"${k}" is too long.`;
    if (k === "status" && type === "Requirement" && !REQUIREMENT_STATUSES.includes(String(v)))
      return `A requirement's status is one of ${REQUIREMENT_STATUSES.join(", ")}.`;
    if (k !== "sequence" && k !== "description" && k !== "title" && typeof v === "string" && !v.trim())
      return `"${k}" can't be empty.`;
  }
  return null;
}

const editable = (t: InitiativeTreeType | undefined): t is InitiativeNodeType => !!t && t in FIELDS;

/** A new node's data: its fields, a fresh key, and provenance. */
function newNodeData(type: InitiativeNodeType, fields: Fields, userId: string, orgId: string, at: string) {
  return {
    ...(STARTS_PROPOSED.includes(type) && { status: "proposed" }),
    ...(type === "HiveInitiative" && { org_id: orgId }),
    ...fields,
    [FIELDS[type].key]: randomUUID(),
    created_at: at,
    created_by: userId,
    created_by_kind: "human",
  };
}

/**
 * Checks `save` against `tree` (null for a new initiative) and turns it into
 * graph writes. Ops apply in order, so a new milestone and a feature under it
 * — or a new story and its requirements — save in one batch. Only nodes of
 * this initiative's tree can be edited or be a parent, and only its planning
 * types (strut writes the architecture).
 */
export function planInitiativeSave(
  tree: InitiativeTreeData | null,
  save: InitiativeSave,
  userId: string,
  orgId: string,
  now = new Date(),
): InitiativePlanResult {
  const { ops } = save;
  if (!ops.length) return bad("Nothing to save.");
  if (ops.length > MAX_OPS) return bad(`At most ${MAX_OPS} changes per save.`);

  const types = new Map<string, InitiativeTreeType>(tree?.nodes.map((n) => [n.ref_id, n.type]) ?? []);
  const temps = new Map<string, InitiativeNodeType>();
  const at = now.toISOString();
  const plan = emptyPlan();

  for (const [i, op] of ops.entries()) {
    const where = `Change ${i + 1}`;
    if (op.op === "choose") return bad(`${where}: a choice is saved on its own.`);
    if (op.op === "remove") {
      const type = types.get(op.ref);
      if (!type) return bad(`${where}: that card isn't part of this initiative.`);
      if (!editable(type) || !REMOVABLE.includes(type)) return bad(`${where}: a ${type} can't be deleted here.`);
      // Soft delete: the reads hide the node and everything under it.
      plan.patches[op.ref] = { ...plan.patches[op.ref], ...softDelete(now) };
      continue;
    }
    if (op.op === "edit") {
      const type = types.get(op.ref);
      if (!type) return bad(`${where}: that card isn't part of this initiative.`);
      if (!editable(type)) return bad(`${where}: a ${type} isn't edited here.`);
      const problem = checkFields(type, op.fields);
      if (problem) return bad(`${where}: ${problem}`);
      plan.patches[op.ref] = { ...plan.patches[op.ref], ...op.fields };
      continue;
    }

    if (temps.has(op.temp) || types.has(op.temp)) return bad(`${where}: duplicate card id.`);
    const problem = checkFields(op.type, op.fields);
    if (problem) return bad(`${where}: ${problem}`);
    const missing = FIELDS[op.type].required.find((k) => op.fields[k] === undefined);
    if (missing) return bad(`${where}: a new ${op.type} needs "${missing}".`);

    let parent: Endpoint | null = null;
    let edgeType: string | null = null;
    if (op.type === "HiveInitiative") {
      if (save.root !== null || i !== 0 || op.parent !== null)
        return bad(`${where}: a new initiative must be the first change of a new plan.`);
    } else {
      if (op.parent === null) return bad(`${where}: a new ${op.type} needs a parent.`);
      const parentType = types.get(op.parent) ?? temps.get(op.parent);
      if (!parentType) return bad(`${where}: the parent isn't part of this initiative.`);
      edgeType = PARENTS[op.type][parentType as InitiativeNodeType] ?? null;
      if (!edgeType) return bad(`${where}: a ${op.type} can't go under a ${parentType}.`);
      parent = types.has(op.parent) ? { ref: op.parent } : { temp: op.parent };
    }
    if (save.root === null && i === 0 && op.type !== "HiveInitiative")
      return bad(`${where}: a new plan starts with its initiative.`);

    plan.creates.push({
      temp: op.temp,
      nodeType: op.type,
      parent,
      edgeType,
      data: newNodeData(op.type, op.fields, userId, orgId, at),
    });
    temps.set(op.temp, op.type);
  }
  return { ok: true, plan };
}

export interface ChoicePlan {
  /** The state changes, saved by the brainstorm writer (`choose` / `unchoose`). */
  brainstormOps: BrainstormOp[];
  /** What the choice makes and takes back in the plan. */
  plan: InitiativePlan;
  undo: boolean;
}

export type ChoicePlanResult = { ok: true; choice: ChoicePlan } | { ok: false; status: 400; message: string };

/** The names an option makes: strut's `makes` list when it set one (empty means nothing), else the option's own words. */
export function makesOf(props: Record<string, unknown>): string[] {
  const own = typeof props.text === "string" ? props.text : typeof props.name === "string" ? props.name : "";
  const list = makesList(props.makes);
  return (list ?? (own.trim() ? [own] : [])).slice(0, MAX_MAKES).map((m) => m.trim().slice(0, MAX_TEXT));
}

/**
 * Choosing `option` in the brainstorm rooted at `root`, which must be about
 * this initiative or a node in it. Choosing marks it chosen (and any other
 * chosen answer to the same question open again), deletes what the other
 * answers made, and makes what it `makes` one level below the node the
 * brainstorm is about — only what it hasn't made already, so choosing again
 * (or retrying after a failed write) never duplicates — each linked
 * `Option -RESULTED_IN->` (a feature also `-SATISFIES->` the requirements the
 * answer argued for). Taking it back (`chosen: false`) opens it again and
 * deletes what it made. Nothing is deleted once work has started on it (a
 * milestone with features, a feature with an architecture, which building
 * it needs).
 */
export function planChoice(
  tree: InitiativeTreeData,
  choices: ChoiceTreeData,
  op: { root: string; option: string; chosen: boolean },
  userId: string,
  orgId: string,
  now = new Date(),
): ChoicePlanResult {
  const about = tree.nodes.find((n) => n.brainstorms?.includes(op.root));
  if (!about) return bad("That brainstorm isn't about this initiative.");
  const option = choices.nodes.find((n) => n.ref_id === op.option);
  // `Choice` is the legacy shape: read, never chosen from here.
  if (option?.type !== "Option") return bad("That answer isn't part of this brainstorm.");
  const questionId = choices.edges.find((e) => e.target === op.option)?.source;
  const question = choices.nodes.find((n) => n.ref_id === questionId && n.type === "Question");
  if (!question) return bad("That answer has no question.");

  const answers = choices.edges
    .filter((e) => e.source === question.ref_id)
    .map((e) => choices.nodes.find((n) => n.ref_id === e.target))
    .filter((n): n is ChoiceTreeData["nodes"][number] => n?.type === "Option");
  const chosen = (n: { properties: Record<string, unknown> }) => n.properties.state === "chosen";
  const undo = !op.chosen;
  const brainstormOps: BrainstormOp[] = undo
    ? chosen(option)
      ? [{ op: "unchoose", ref: option.ref_id }]
      : []
    : [
        ...answers
          .filter((a) => a.ref_id !== option.ref_id && chosen(a))
          .map((a) => ({ op: "unchoose" as const, ref: a.ref_id })),
        ...(chosen(option) ? [] : [{ op: "choose" as const, ref: option.ref_id }]),
      ];

  const plan = emptyPlan();
  // Choosing takes back what the other answers made; taking it back, what this one made. Not once work has started.
  const answerIds = new Set(
    answers.map((a) => a.ref_id).filter((id) => (undo ? id === option.ref_id : id !== option.ref_id)),
  );
  const children = (id: string, type: string) =>
    tree.edges.filter((e) => e.source === id && tree.nodes.some((n) => n.ref_id === e.target && n.type === type));
  const started = (n: InitiativeTreeData["nodes"][number]) =>
    n.type === "HiveMilestone"
      ? children(n.ref_id, "InitiativeFeature").length > 0
      : children(n.ref_id, "Architecture").length > 0;
  for (const n of tree.nodes)
    if (n.madeBy?.some((o) => answerIds.has(o)) && !started(n)) plan.patches[n.ref_id] = softDelete(now);

  const makes = MAKES[about.type];
  if (!undo && makes) {
    const at = now.toISOString();
    const nextSequence =
      1 +
      Math.max(
        0,
        ...tree.nodes
          .filter((n) => n.type === "HiveMilestone" && !plan.patches[n.ref_id])
          .map((n) => (typeof n.properties.sequence === "number" ? n.properties.sequence : 0)),
      );
    const meets = (option.effects ?? [])
      .filter((e) => e.direction === "pro")
      .flatMap((e) => e.against ?? [])
      .filter(
        (r, i, all) => all.indexOf(r) === i && tree.nodes.some((n) => n.ref_id === r && n.type === "Requirement"),
      );
    // What this answer made already (and still stands) isn't made again.
    const made = new Set(
      tree.nodes
        .filter((n) => n.type === makes.type && n.madeBy?.includes(option.ref_id) && !plan.patches[n.ref_id])
        .map((n) => String(n.properties.name ?? "")),
    );
    makesOf(option.properties)
      .filter((name) => !made.has(name))
      .forEach((name, i) => {
        const temp = `made-${i}`;
        const fields: Fields = { name, ...(makes.type === "HiveMilestone" && { sequence: nextSequence + i }) };
        plan.creates.push({
          temp,
          nodeType: makes.type,
          parent: { ref: about.ref_id },
          edgeType: makes.edge,
          data: newNodeData(makes.type, fields, userId, orgId, at),
        });
        plan.links.push({ edgeType: "RESULTED_IN", source: { ref: option.ref_id }, target: { temp } });
        if (makes.type === "InitiativeFeature")
          for (const r of meets) plan.links.push({ edgeType: "SATISFIES", source: { temp }, target: { ref: r } });
      });
  }
  return { ok: true, choice: { brainstormOps, plan, undo } };
}

export type InitiativeSaveResult =
  | { ok: true; data: { root: string; created: Record<string, string> } }
  | { ok: false; status: number; message: string };

interface Caller {
  slug: string;
  userId: string;
}

type Written =
  | { ok: true; created: Record<string, string> }
  | { ok: false; message: string; created: Record<string, string> };

/** Applies a plan through Jarvis; a node whose parent link fails is soft-deleted again, so no orphan is left. */
async function writePlan(
  config: { jarvisUrl: string; apiKey: string },
  plan: InitiativePlan,
  now: Date,
): Promise<Written> {
  const created: Record<string, string> = {};
  const idOf = (e: Endpoint) => ("ref" in e ? e.ref : created[e.temp]);
  const ref = (e: Endpoint): JarvisEdgeEndpoint => ({ ref_id: idOf(e) });
  for (const c of plan.creates) {
    const res = await addNode(config, { node_type: c.nodeType, node_data: c.data });
    // A fresh UUID key that "already exists" is a clash, never a merge.
    if (!res.success || !res.ref_id || res.alreadyExists)
      return { ok: false, message: res.error ?? "The graph didn't take the new card.", created };
    if (c.parent && c.edgeType) {
      const edge = await addEdgeV2(config, {
        edge: { edge_type: c.edgeType },
        source: ref(c.parent),
        target: { ref_id: res.ref_id },
      });
      if (!edge.success) {
        await updateNodeV2(config, res.ref_id, { deleted_at: now.getTime(), is_deleted: true });
        return { ok: false, message: edge.message ?? "The graph didn't link the new card.", created };
      }
    }
    created[c.temp] = res.ref_id;
  }
  // Patches don't depend on each other, nor do links once the cards exist: each set goes at once.
  const patched = await Promise.all(Object.entries(plan.patches).map(([id, data]) => updateNodeV2(config, id, data)));
  const badPatch = patched.find((r) => !r.success);
  if (badPatch) return { ok: false, message: badPatch.message ?? "The graph didn't take a change.", created };
  const linked = await Promise.all(
    plan.links.map((l) =>
      addEdgeV2(config, { edge: { edge_type: l.edgeType }, source: ref(l.source), target: ref(l.target) }),
    ),
  );
  const badLink = linked.find((r) => !r.success);
  if (badLink) return { ok: false, message: badLink.message ?? "The graph didn't take a link.", created };
  return { ok: true, created };
}

/**
 * Saves a person's batch of edits to one initiative's plan. The caller must
 * already have checked the person may write in the workspace (DEVELOPER and
 * above); `resolveGraphJarvis` checks it again before any write.
 */
export async function saveInitiativeChanges(caller: Caller, save: InitiativeSave): Promise<InitiativeSaveResult> {
  if (save.root !== null && !isRunGraphRefId(save.root)) return { ok: false, status: 400, message: "Invalid root" };

  const workspace = await db.workspace.findFirst({
    where: { slug: caller.slug, deleted: false },
    select: { sourceControlOrgId: true, sourceControlOrg: { select: { githubLogin: true } } },
  });
  if (!workspace?.sourceControlOrgId)
    return { ok: false, status: 404, message: "Workspace not found or access denied." };

  let tree: InitiativeTreeData | null = null;
  if (save.root !== null) {
    const read = await getInitiativeTree(caller, save.root);
    if (!read.ok) return { ok: false, status: read.status, message: read.message };
    if (!read.data.nodes.some((n) => n.ref_id === save.root))
      return { ok: false, status: 404, message: "That initiative is no longer in the graph." };
    tree = read.data;
  }

  const now = new Date();
  const choose = save.ops.find((o): o is Extract<InitiativeOp, { op: "choose" }> => o.op === "choose");
  let plan: InitiativePlan;
  if (choose) {
    if (save.ops.length !== 1 || !tree) return { ok: false, status: 400, message: "A choice is saved on its own." };
    if (!isRunGraphRefId(choose.root) || !isRunGraphRefId(choose.option))
      return { ok: false, status: 400, message: "Invalid brainstorm." };
    const choices = await getChoiceTree(caller, choose.root);
    if (!choices.ok) return { ok: false, status: choices.status, message: choices.message };
    const planned = planChoice(tree, choices.data, choose, caller.userId, workspace.sourceControlOrgId, now);
    if (!planned.ok) return planned;
    // The choice itself first, through the brainstorm writer (its stamps, its access check, its live update).
    if (planned.choice.brainstormOps.length) {
      const marked = await saveBrainstormChanges(caller, { root: choose.root, ops: planned.choice.brainstormOps });
      if (!marked.ok) return { ok: false, status: marked.status, message: marked.message };
    }
    plan = planned.choice.plan;
  } else {
    const planned = planInitiativeSave(tree, save, caller.userId, workspace.sourceControlOrgId, now);
    if (!planned.ok) return planned;
    plan = planned.plan;
  }

  let written: Written;
  if (process.env.USE_MOCKS === "true") {
    written = { ok: true, created: mockInitiativeWrite(save.root, plan) };
  } else {
    const access = await resolveGraphJarvis(workspace.sourceControlOrgId, caller.userId, { slug: caller.slug });
    if (!access.ok) return { ok: false, status: 403, message: access.error };
    written = await writePlan(access.access.config, plan, now);
  }
  const first = save.ops[0];
  const root = save.root ?? (first.op === "add" ? written.created[first.temp] : "");
  // Partly written is still written: tell the open canvases either way.
  const login = workspace.sourceControlOrg?.githubLogin;
  if (login && root) notifyInitiativeUpdated(login, { workspaceSlug: caller.slug, root });
  if (!written.ok) return { ok: false, status: 502, message: written.message };
  return { ok: true, data: { root, created: written.created } };
}
