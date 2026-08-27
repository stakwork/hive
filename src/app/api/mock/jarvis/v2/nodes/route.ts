import { NextRequest, NextResponse } from "next/server";
import { mockSearchNodes, resolveMockNodeNamespace, type MockSearchNode } from "./search-fixtures";

/**
 * Mock GET /v2/nodes — Jarvis v2 ranked node search (the endpoint `kgSearch`
 * in `src/lib/ai/kg-adapter.ts` calls). Serves the fixture corpus from
 * `./search-fixtures` so `graph_search` is servable under `USE_MOCKS`.
 *
 * Query params (all optional, mirroring what kgSearch sends):
 *   - q                   case-insensitive substring match against name-ish
 *                         and description/summary/text fields
 *   - type                comma-separated node types, case-insensitive exact
 *                         match against real labels (e.g. "File,HiveTask")
 *   - domains             comma-separated domain filter; fixtures that declare
 *                         no domains stay visible, declared ones must intersect
 *   - limit               max results, default 20 (kgSearch's default)
 *   - include_edge_counts when "true", attaches a plausible {EDGE_TYPE: count}
 *                         map to every returned node
 *   - namespace           partition filter. Absent/blank → the full corpus.
 *                         Matching → that subset. Unknown → empty set with
 *                         HTTP 200 — mirrors Jarvis's Cypher predicate
 *                         (`n.namespace = $namespace`) returning 200-with-
 *                         zero-rows rather than a 4xx. Lookup checks
 *                         properties.namespace first, top-level fallback.
 *
 * Response envelope matches what kgSearch parses for this endpoint:
 * `{ status: "success", nodes: [...] }`.
 */

/** Plausible per-type {EDGE_TYPE: count} maps used when a returned fixture declares no static edges map. */
const PLAUSIBLE_EDGE_COUNTS: Record<string, Record<string, number>> = {
  Repository: { OWNS: 9, PUSHED: 3 },
  File: { IMPORTS: 4, HAS_FUNCTION: 2 },
  Function: { CALLS: 6, CALLER: 2 },
  PullRequest: { MODIFIES: 5, MERGED_INTO: 1 },
  HiveFeature: { HAS_TASK: 8, IN_PHASE: 1 },
  HiveTask: { ASSIGNED_TO: 1, PART_OF: 1 },
  Concept: { RELATES_TO: 3, MENTIONS: 2 },
  Skill: { USES: 2 },
};

/** Default result cap — matches kgSearch's own default limit of 20. */
const DEFAULT_LIMIT = 20;

function splitListParam(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Lowercased searchable blob: name-ish fields, code identifiers, descriptive bodies. */
function searchableText(node: MockSearchNode): string {
  const props = (node.properties ?? {}) as Record<string, unknown>;
  return [
    // Human labels
    node.name,
    props.name,
    props.title,
    props.label,
    props.display_name,
    // Code-graph identifiers
    props.function_name,
    props.class_name,
    props.method_name,
    props.symbol,
    props.file_name,
    props.path,
    props.slug,
    // Descriptive bodies
    props.description,
    props.summary,
    props.text,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function declaredDomains(node: MockSearchNode): string[] {
  const raw = (node.properties as Record<string, unknown> | undefined)?.domains;
  if (Array.isArray(raw)) {
    return raw.filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase());
  }
  if (typeof raw === "string") {
    return splitListParam(raw).map((d) => d.toLowerCase());
  }
  return [];
}

/**
 * Deterministic, plausible connectivity map for a node under
 * include_edge_counts=true: the fixture's static map when it declares one,
 * otherwise a small per-type default (generic fallback for unlisted types).
 */
function edgeCountsFor(node: MockSearchNode): Record<string, number> {
  if (node.edges) return node.edges;
  return PLAUSIBLE_EDGE_COUNTS[node.node_type] ?? { SIMILAR_TO: 1 };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;

  // Blank/absent namespace means "no partition filter" (default behaviour).
  const namespace = (params.get("namespace") ?? "").trim();
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const types = splitListParam(params.get("type")).map((t) => t.toLowerCase());
  const domains = splitListParam(params.get("domains")).map((d) => d.toLowerCase());
  const includeEdgeCounts = params.get("include_edge_counts") === "true";

  const limitRaw = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 0 ? limitRaw : DEFAULT_LIMIT;

  let matches = mockSearchNodes;

  if (namespace) {
    matches = matches.filter((node) => resolveMockNodeNamespace(node) === namespace);
  }
  if (q) {
    matches = matches.filter((node) => searchableText(node).includes(q));
  }
  if (types.length > 0) {
    matches = matches.filter((node) => types.includes(node.node_type.toLowerCase()));
  }
  if (domains.length > 0) {
    // Fixtures declaring no domains are presumed universally visible; ones
    // that do declare domains must intersect the requested set.
    matches = matches.filter((node) => {
      const declared = declaredDomains(node);
      return declared.length === 0 || declared.some((d) => domains.includes(d));
    });
  }

  const limited = matches.slice(0, limit);
  const nodes = includeEdgeCounts ? limited.map((node) => ({ ...node, edges: edgeCountsFor(node) })) : limited;

  return NextResponse.json({ status: "success", nodes }, { status: 200 });
}

/**
 * Mock POST /v2/nodes — Jarvis single-node create
 *
 * Supports three scenarios via `_mock_scenario` in the request body:
 *   - "warning"  → 200 { status: "Warning", data: { ref_id } }  (duplicate / already-exists)
 *   - "fail"     → 200 { status: "fail", message }               (Jarvis-level rejection)
 *   - default    → 200 { status: "success", data: { ref_id } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  const scenario = (body._mock_scenario as string | undefined) ?? "success";
  const mockRefId = "mock-node-ref-001";

  if (scenario === "warning") {
    return NextResponse.json(
      {
        status: "Warning",
        message: "Node already exists",
        data: { ref_id: mockRefId },
        status_messages: ["Node already exists"],
      },
      { status: 200 },
    );
  }

  if (scenario === "fail") {
    return NextResponse.json(
      { status: "fail", message: "node_key collision: node_data conflict" },
      { status: 200 },
    );
  }

  // Default: success
  return NextResponse.json(
    {
      status: "success",
      data: { ref_id: mockRefId },
    },
    { status: 200 },
  );
}
