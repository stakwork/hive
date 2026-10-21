/**
 * People's own edits to an initiative's plan on the canvas, written straight
 * to the graph: rename an initiative, edit the brief's why, add a milestone,
 * feature, story or requirement, accept or drop a requirement. Jamie and strut
 * write the same nodes through strut's graph steps; both follow the Jarvis
 * ontology (migrations 133 and 134).
 *
 * A save is a batch of ops against one initiative. `planInitiativeSave` checks
 * it against the tree as it is now and turns it into graph writes (pure, no
 * I/O); `saveInitiativeChanges` reads the tree, plans, and writes through
 * Jarvis (or the mock store). Every new node gets a fresh UUID key and
 * `created_*` provenance; every write stamps `updated_at`.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { isRunGraphRefId } from "@/lib/strut-run-graph/hydrate";
import { addEdgeV2, addNode, updateNodeV2, type JarvisEdgeEndpoint } from "@/services/swarm/api/nodes";
import { mockInitiativeWrite } from "@/app/api/mock/graph/initiative-fixture";
import { getInitiativeTree, type InitiativeNodeType, type InitiativeTreeData } from "./workbench";

export const MAX_OPS = 50;
export const MAX_TEXT = 4000;

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
  InitiativeFeature: { HiveInitiative: "HAS_FEATURE", HiveMilestone: "HAS_FEATURE" },
  UserStory: { InitiativeFeature: "HAS_STORY" },
  Requirement: { UserStory: "HAS_REQUIREMENT" },
};

/** Jarvis requires `status` on these; a new one starts proposed. */
const STARTS_PROPOSED: InitiativeNodeType[] = ["InitiativeFeature", "UserStory", "Requirement"];
export const REQUIREMENT_STATUSES = ["proposed", "accepted", "dropped"];

export type Fields = Record<string, string | number>;

export type InitiativeOp =
  | { op: "add"; temp: string; type: InitiativeNodeType; parent: string | null; fields: Fields }
  | { op: "edit"; ref: string; fields: Fields };

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
}

export type InitiativePlanResult = { ok: true; plan: InitiativePlan } | { ok: false; status: 400; message: string };

const bad = (message: string): InitiativePlanResult => ({ ok: false, status: 400, message });

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

/**
 * Checks `save` against `tree` (null for a new initiative) and turns it into
 * graph writes. Ops apply in order, so a new milestone and a feature under it
 * save in one batch. Only nodes of this initiative's tree can be edited or
 * be a parent.
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

  const types = new Map<string, InitiativeNodeType>(tree?.nodes.map((n) => [n.ref_id, n.type]) ?? []);
  const temps = new Map<string, InitiativeNodeType>();
  const at = now.toISOString();
  const plan: InitiativePlan = { creates: [], patches: {} };

  for (const [i, op] of ops.entries()) {
    const where = `Change ${i + 1}`;
    if (op.op === "edit") {
      const type = types.get(op.ref);
      if (!type) return bad(`${where}: that card isn't part of this initiative.`);
      const problem = checkFields(type, op.fields);
      if (problem) return bad(`${where}: ${problem}`);
      plan.patches[op.ref] = { ...plan.patches[op.ref], ...op.fields, updated_at: at };
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
      edgeType = PARENTS[op.type][parentType] ?? null;
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
      data: {
        ...(STARTS_PROPOSED.includes(op.type) && { status: "proposed" }),
        ...(op.type === "HiveInitiative" && { org_id: orgId }),
        ...op.fields,
        [FIELDS[op.type].key]: randomUUID(),
        created_at: at,
        updated_at: at,
        created_by: userId,
        created_by_kind: "human",
      },
    });
    temps.set(op.temp, op.type);
  }
  return { ok: true, plan };
}

export type InitiativeSaveResult =
  | { ok: true; data: { root: string; created: Record<string, string> } }
  | { ok: false; status: number; message: string };

interface Caller {
  slug: string;
  userId: string;
}

/** Applies a plan through Jarvis; a node whose parent link fails is soft-deleted again, so no orphan is left. */
async function writePlan(
  config: { jarvisUrl: string; apiKey: string },
  plan: InitiativePlan,
  now: Date,
): Promise<
  { ok: true; created: Record<string, string> } | { ok: false; message: string; created: Record<string, string> }
> {
  const created: Record<string, string> = {};
  const ref = (e: Endpoint): JarvisEdgeEndpoint => ({ ref_id: "ref" in e ? e.ref : created[e.temp] });
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
  for (const [id, data] of Object.entries(plan.patches)) {
    const res = await updateNodeV2(config, id, data);
    if (!res.success) return { ok: false, message: res.message ?? "The graph didn't take a change.", created };
  }
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
    select: { sourceControlOrgId: true },
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
  const planned = planInitiativeSave(tree, save, caller.userId, workspace.sourceControlOrgId, now);
  if (!planned.ok) return planned;

  let written: Awaited<ReturnType<typeof writePlan>>;
  if (process.env.USE_MOCKS === "true") {
    written = { ok: true, created: mockInitiativeWrite(save.root, planned.plan) };
  } else {
    const access = await resolveGraphJarvis(workspace.sourceControlOrgId, caller.userId, { slug: caller.slug });
    if (!access.ok) return { ok: false, status: 403, message: access.error };
    written = await writePlan(access.access.config, planned.plan, now);
  }
  if (!written.ok) return { ok: false, status: 502, message: written.message };
  const root = save.root ?? written.created[(save.ops[0] as { temp: string }).temp];
  return { ok: true, data: { root, created: written.created } };
}
