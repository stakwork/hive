/**
 * Schema utility helpers for graph node schema processing.
 */

/**
 * Represents a minimal schema definition with the fields needed to determine
 * searchable attributes. Mirrors the Jarvis graph service schema shape.
 */
export interface SchemaDefinition {
  index?: string | string[];
  node_key?: string;
  [key: string]: unknown;
}

/**
 * Returns the list of fulltext-searchable attribute names for a given schema,
 * using the following priority chain:
 *
 * 1. If `index` is set and non-empty → return those field(s) (normalised to array).
 * 2. Else if `node_key` is set and non-empty → return `[node_key]`.
 * 3. Else → fall back to all top-level properties whose value type annotation is
 *    `string` or `?string` (i.e. all string-valued keys in the schema object,
 *    excluding `index`, `node_key`, and non-string typed fields).
 *
 * This matches the intended behaviour of `get_searchable_attributes_from_schema`
 * in the Jarvis graph service.
 */
export function getSearchableAttributesFromSchema(schema: SchemaDefinition): string[] {
  // Priority 1: use declared `index` field
  const { index, node_key, ...rest } = schema;

  if (index !== undefined && index !== null) {
    if (Array.isArray(index)) {
      const normalised = index.filter((f) => typeof f === "string" && f.length > 0);
      if (normalised.length > 0) return normalised;
    } else if (typeof index === "string" && index.length > 0) {
      return [index];
    }
  }

  // Priority 2: fall back to node_key
  if (typeof node_key === "string" && node_key.length > 0) {
    return [node_key];
  }

  // Priority 3: scrape all string-typed properties (existing fallback behaviour)
  return Object.keys(rest).filter((key) => typeof rest[key] === "string");
}
