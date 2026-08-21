import { NextResponse } from "next/server";

/**
 * Mock GET /v2/schema?include_attributes=true&include_edges=true
 *
 * Returns a small representative Jarvis schema payload for dev/mock canvas.
 * Without this route the new `get_ontology_type` tool always returns
 * "swarm unreachable" in the dev environment, preventing the pre-write
 * guided self-correction flow from being exercised end-to-end.
 *
 * Includes:
 * - A type (`Concept`) with both `attributes` and `inherited_attributes`,
 *   to exercise merged required-field resolution.
 * - A wildcard (`"*"`) edge, to verify wildcard inclusion in edge filtering.
 * - A deleted type and the `"*"` sentinel type, to confirm they are excluded.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    schemas: [
      {
        type: "Concept",
        domain: "entity",
        description: "A knowledge-graph concept node.",
        node_key: "name",
        parent: "Thing",
        // Declared attributes on Concept itself.
        attributes: {
          name: "string",
          summary: "?string",
          domain: "?string",
        },
        // Inherited attributes from the parent chain (e.g. Thing).
        inherited_attributes: {
          // `name` already declared above — declared wins; this is ignored.
          name: "string",
          label: "?string",
          // Reserved keys — must never surface as attributes.
          is_deleted: false,
          status: "?string",
          boost: "?number",
          algo_score: "?float",
        },
      },
      {
        type: "HiveFeature",
        domain: "hive",
        description: "A Hive roadmap feature mirrored into the KG.",
        node_key: "ref_id",
        parent: "Thing",
        attributes: {
          ref_id: "string",
          title: "string",
          brief: "?string",
        },
        inherited_attributes: {
          label: "?string",
        },
      },
      {
        type: "File",
        domain: "code",
        description: "A source file in a repository.",
        node_key: "file_name",
        attributes: {
          file_name: "string",
          path: "?string",
          language: "?string",
        },
        inherited_attributes: {},
      },
      // Deleted type — must be excluded from results.
      {
        type: "OldType",
        domain: "legacy",
        description: "A removed type.",
        is_deleted: true,
        attributes: {},
        inherited_attributes: {},
      },
      // Wildcard sentinel — must be excluded from type lookups.
      {
        type: "*",
        domain: null,
        description: "Schema wildcard.",
        attributes: {},
        inherited_attributes: {},
      },
    ],
    edges: [
      // Type-specific edge: Concept → Concept
      {
        ref_id: "edge-001",
        source_type: "Concept",
        target_type: "Concept",
        edge_type: "RELATED_TO",
      },
      // Type-specific edge: HiveFeature → Concept
      {
        ref_id: "edge-002",
        source_type: "HiveFeature",
        target_type: "Concept",
        edge_type: "IMPLEMENTS",
      },
      // Wildcard edge — applies to any source type.
      {
        ref_id: "edge-003",
        source_type: "*",
        target_type: "Concept",
        edge_type: "CITES",
      },
      // Wildcard edge — applies to any target type.
      {
        ref_id: "edge-004",
        source_type: "Concept",
        target_type: "*",
        edge_type: "MENTIONS",
      },
      // Unrelated edge — should NOT appear when querying for Concept or File.
      {
        ref_id: "edge-005",
        source_type: "HiveFeature",
        target_type: "HiveTask",
        edge_type: "HAS_TASK",
      },
    ],
  });
}
