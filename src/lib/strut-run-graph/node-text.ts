/**
 * What of a node is its text. A reader wants a node's prose first — a
 * Concept's docs, a Document's content — and its other attributes after.
 * Shared with the run report's node peek, so every surface that opens a
 * node reads it the same way. Pure: no graph, no React.
 */

/**
 * The properties that hold a node's text, in the order they are looked for.
 * Concepts carry theirs in `docs` (canonical) or `documentation` (deprecated,
 * still live on older nodes); other types use the rest.
 */
export const NODE_TEXT_KEYS: readonly string[] = [
  "docs",
  "documentation",
  "description",
  "definition",
  "body",
  "content",
  "text",
  "summary",
];

/** Identity the panel already shows, and labels that mean nothing to a reader. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "ref_id",
  "node_type",
  "name",
  "namespace",
  "date_added_to_graph",
  "Data_Bank",
]);

export interface NodeText {
  /** `[property, markdown]` for each text property the node has, in `NODE_TEXT_KEYS` order. */
  prose: Array<[string, string]>;
  /** Every other property with a value, as `[property, value]`. */
  rest: Array<[string, unknown]>;
}

function asProse(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) return value.join("\n\n");
  return null;
}

/** Nothing to show: unset, or a string with nothing in it. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

export function nodeText(properties: Record<string, unknown>): NodeText {
  const prose: Array<[string, string]> = [];
  for (const key of NODE_TEXT_KEYS) {
    const text = asProse(properties[key]);
    if (text !== null) prose.push([key, text]);
  }
  const shown = new Set(prose.map(([key]) => key));
  const rest = Object.entries(properties).filter(
    ([key, value]) => !IDENTITY_KEYS.has(key) && !shown.has(key) && !isBlank(value),
  );
  return { prose, rest };
}
