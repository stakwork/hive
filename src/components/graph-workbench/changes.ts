/**
 * A proposed change to a graph, as the workbench draws it before anyone has
 * approved it. Endpoints name nodes loosely — a ref_id, a concept's own id,
 * or a name — because proposals do; `findNode` resolves them against what's
 * loaded, and anything it can't resolve is drawn as a new node.
 */

import { bounded } from "@/lib/strut-chat-activity";

/** New docs (`docs`) or changed properties as JSON text (`edit`) for an existing node. */
export interface NodeEdit {
  kind: "docs" | "edit";
  before: string;
  after: string;
}

export type GraphChange =
  /** A node that would be created, under `parent` when it has one. */
  | { kind: "node"; name: string; type?: string; parent?: string; description?: string; docs?: string }
  | (NodeEdit & { node: string })
  /** An edge that would be added. */
  | { kind: "edge"; edge: string; source: string; target: string };

const MAX_CHANGES = 50;
const MAX_TEXT = 100_000;
const MAX_NAME = 300;

const str = (v: unknown, max = MAX_NAME): string | undefined => bounded(v, max) ?? undefined;

function parseChange(raw: unknown): GraphChange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "node": {
      const name = str(r.name);
      return name
        ? {
            kind: "node",
            name,
            type: str(r.type),
            parent: str(r.parent),
            description: str(r.description, MAX_TEXT),
            docs: str(r.docs, MAX_TEXT),
          }
        : null;
    }
    case "docs":
    case "edit": {
      const node = str(r.node);
      const before = typeof r.before === "string" && r.before.length <= MAX_TEXT ? r.before : null;
      const after = typeof r.after === "string" && r.after.length <= MAX_TEXT ? r.after : null;
      return node && before !== null && after !== null ? { kind: r.kind, node, before, after } : null;
    }
    case "edge": {
      const edge = str(r.edge);
      const source = str(r.source);
      const target = str(r.target);
      return edge && source && target ? { kind: "edge", edge, source, target } : null;
    }
    default:
      return null;
  }
}

/** Changes out of stored JSON: what doesn't fit is dropped, never repaired. Undefined when there are none. */
export function parseGraphChanges(raw: unknown): GraphChange[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const changes = raw.slice(0, MAX_CHANGES).flatMap((c) => {
    const parsed = parseChange(c);
    return parsed ? [parsed] : [];
  });
  return changes.length ? changes : undefined;
}
