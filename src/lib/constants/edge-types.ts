/**
 * Shared server-side edge-type allow-list for knowledge-graph edge writes.
 *
 * Lifted from the Lingo AddEdgePanel's COMMON_EDGE_TYPES / EDGE_TYPE_MAP so
 * both the Lingo UI and the `propose_edge` tool use the same canonical set.
 *
 * ## Security note
 * Relationship-type labels are forwarded verbatim into a downstream Cypher
 * `MERGE` clause and CANNOT be parameterized (Neo4j only supports params for
 * property values, not labels/types). An allow-list + strict charset check
 * (`^[A-Z][A-Z0-9_]*$`) is therefore the only protection against arbitrary-
 * label minting / injection. Validate at BOTH propose time (UX guard) and
 * approval time (security-critical server-side check) before the value is
 * forwarded to Jarvis.
 */

/** All valid edge types for inter-node relationships in the KG. */
export const ALLOWED_EDGE_TYPES = new Set([
  "RELATED_TO",
  "PART_OF",
  "DEPENDS_ON",
  "SYNONYM_OF",
  "EXTENDS",
  "HAS_DEFINITION",
  "SUPERSEDES",
  "HAS_TASK",
  "HAS_MESSAGE",
  "RESULTED_IN",
  "IMPLEMENTS",
  "REFERENCES",
  "BLOCKS",
  "CONTAINS",
  "MODIFIES",
  "CITES",
]);

/** Regex for a valid relationship-type label (`SCREAMING_SNAKE_CASE`). */
const EDGE_TYPE_CHARSET_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Returns true when `edgeType` is a valid, allow-listed relationship type.
 * Validates both the charset (injection guard) and the allow-list (schema
 * pollution guard).
 *
 * Callers must reject unknown types rather than forwarding them to Jarvis.
 */
export function isValidEdgeType(edgeType: unknown): edgeType is string {
  if (typeof edgeType !== "string") return false;
  if (!EDGE_TYPE_CHARSET_RE.test(edgeType)) return false;
  return ALLOWED_EDGE_TYPES.has(edgeType);
}
