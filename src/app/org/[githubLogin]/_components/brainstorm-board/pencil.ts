/**
 * Pencil: the cards a person has written on the desk but not saved yet. Pure
 * helpers, no React. A batch holds one brainstorm's unsaved edits; Save posts
 * it to `POST /api/workspaces/[ws]/graph/brainstorms/changes`, which writes
 * it to the graph.
 *
 * Only hand-written cards are pencil. Decisions (Go with, Drop…) go to Jamie's
 * chat as before.
 */

export type PencilOp =
  | { op: "add_question"; temp: string; parent: string | null; text: string }
  | { op: "add_option"; temp: string; parent: string; text: string }
  | { op: "edit_text"; ref: string; text: string };

export interface PencilBatch {
  ws: string;
  /** The tree's root ref_id; null for a brainstorm started on the desk (its first op is a parentless question). */
  root: string | null;
  ops: PencilOp[];
}

/** Batches by key: the root ref_id, or a new brainstorm's temp id. */
export type Pencil = Record<string, PencilBatch>;

export interface RawTree {
  nodes?: Array<{ ref_id: string; type?: string; properties?: Record<string, unknown> }>;
  edges?: Array<{ source: string; target: string }>;
}

let seq = 0;
/** A temp id for a new card: the save route's `TEMP_RE` (letters, digits, `_`, `-`). */
export const newTempId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

const isAdd = (o: PencilOp): o is Extract<PencilOp, { temp: string }> =>
  o.op === "add_question" || o.op === "add_option";

/** Adds a hand-written card; a parentless question starts a new brainstorm keyed by its own temp id. */
export function addCard(
  p: Pencil,
  key: string,
  ws: string,
  root: string | null,
  op: Extract<PencilOp, { temp: string }>,
): Pencil {
  const batch = p[key] ?? { ws, root, ops: [] };
  return { ...p, [key]: { ...batch, ops: [...batch.ops, op] } };
}

/** Rewrites a card: an unsaved card's own text, else a text edit of a saved one (the last edit wins). */
export function setText(p: Pencil, key: string, ws: string, root: string, id: string, text: string): Pencil {
  const batch = p[key] ?? { ws, root, ops: [] };
  const own = batch.ops.find((o) => isAdd(o) && o.temp === id);
  const ops = own
    ? batch.ops.map((o) => (o === own ? { ...own, text } : o))
    : [
        ...batch.ops.filter((o) => !(o.op === "edit_text" && o.ref === id)),
        { op: "edit_text" as const, ref: id, text },
      ];
  return { ...p, [key]: { ...batch, ops } };
}

/** Throws away an unsaved card and every unsaved card under it; an emptied batch goes. */
export function discard(p: Pencil, key: string, temp: string): Pencil {
  const batch = p[key];
  if (!batch) return p;
  const gone = new Set([temp]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of batch.ops)
      if (isAdd(o) && o.parent && gone.has(o.parent) && !gone.has(o.temp)) (gone.add(o.temp), (grew = true));
  }
  const ops = batch.ops.filter((o) => !(isAdd(o) && gone.has(o.temp)) && !(o.op === "edit_text" && gone.has(o.ref)));
  const { [key]: _, ...rest } = p;
  return ops.length && !(batch.root === null && gone.has(key)) ? { ...p, [key]: { ...batch, ops } } : rest;
}

/** Drops a batch once the graph has it. */
export function clearSaved(p: Pencil, key: string): Pencil {
  const { [key]: _, ...rest } = p;
  return rest;
}

/** True for a card that only exists in pencil. */
export const isPencilId = (p: PencilBatch | undefined, id: string) => !!p?.ops.some((o) => isAdd(o) && o.temp === id);

/**
 * The tree as the person sees it: the graph's tree with their unsaved cards
 * written in. A pencil card carries `pencil: true`, `made_by: "user"` and the
 * person as `speaker`, and sorts after its saved siblings.
 */
export function withPencil(raw: RawTree | undefined, batch: PencilBatch | undefined, me: string | null): RawTree {
  const nodes = (raw?.nodes ?? []).map((n) => ({ ...n, properties: { ...n.properties } }));
  const edges = [...(raw?.edges ?? [])];
  if (!batch) return { nodes, edges };
  const byId = new Map(nodes.map((n) => [n.ref_id, n]));
  batch.ops.forEach((o, i) => {
    if (isAdd(o)) {
      const question = o.op === "add_question";
      const node = {
        ref_id: o.temp,
        type: question ? "Question" : "Option",
        properties: {
          [question ? "question_id" : "option_id"]: `9999999999999-pencil-${String(i).padStart(6, "0")}`,
          text: o.text,
          made_by: "user",
          ...(me ? { speaker: me } : {}),
          state: "open",
          pencil: true,
        } as Record<string, unknown>,
      };
      nodes.push(node);
      byId.set(o.temp, node);
      if (o.parent) edges.push({ source: o.parent, target: o.temp });
    } else {
      const n = byId.get(o.ref);
      if (n) n.properties = { ...n.properties, text: o.text, pencil: true };
    }
  });
  return { nodes, edges };
}
