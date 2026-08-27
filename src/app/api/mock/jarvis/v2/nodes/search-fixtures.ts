/**
 * Fixture corpus for the mock Jarvis `GET /v2/nodes` search endpoint.
 *
 * Shaped exactly like what `kgSearch` (`src/lib/ai/kg-adapter.ts`) parses from
 * real Jarvis: objects with `ref_id`, `node_type`, optional top-level `name`,
 * and a `properties` record carrying at least one of `description` / `summary`
 * / `text` (the three fields `kgSearch` derives its hit `description` from).
 *
 * Deliberately NOT reused from `recursion-fixture.ts` /
 * `fix-snapshot-fixtures.ts` — those are shaped for the legal/benchmark graph
 * surfaces, not `/v2/nodes` search hits.
 *
 * Namespaces: Hive cannot confirm which shape live Jarvis returns the
 * partition marker in, so fixtures deliberately exercise BOTH placements and
 * lookup goes through `resolveMockNodeNamespace`:
 *   - most fixtures carry `properties.namespace` (matching Hive's own kg-node
 *     test builders, e.g. `error-stack-frames.test.ts`)
 *   - one fixture carries ONLY a top-level `namespace` field (fallback path)
 *   - one fixture carries BOTH, with different values, pinning the precedence
 *     rule: `properties.namespace` wins
 *   - several fixtures carry NO namespace at all (the default partition that
 *     un-namespaced queries see today)
 */

export interface MockSearchNode {
  ref_id: string;
  node_type: string;
  name?: string;
  /** Top-level namespace — legacy/fallback placement, see module docblock. */
  namespace?: string;
  properties?: Record<string, unknown>;
  /**
   * Optional static `{EDGE_TYPE: count}` connectivity map. When omitted, the
   * route synthesizes a plausible per-type map when `include_edge_counts=true`
   * (which `kgSearch` always sends).
   */
  edges?: Record<string, number>;
}

/**
 * Resolve which partition a fixture belongs to. `properties.namespace` is
 * authoritative; a top-level `namespace` is only consulted as a fallback.
 * Returns `null` for the default (un-namespaced) partition.
 */
export function resolveMockNodeNamespace(
  node: Pick<MockSearchNode, "namespace" | "properties"> | null | undefined,
): string | null {
  const props = (node?.properties ?? {}) as Record<string, unknown>;
  if (typeof props.namespace === "string" && props.namespace.length > 0) {
    return props.namespace;
  }
  if (typeof node?.namespace === "string" && node.namespace.length > 0) {
    return node.namespace;
  }
  return null;
}

/**
 * Mixed product/code-graph corpus: ≥2 `properties.namespace` partitions
 * ("acme-core", "research-lab"), one top-level-only partition
 * ("platform-governance"), one precedence-proving dual-placement fixture, and
 * three default-partition fixtures with no namespace anywhere.
 *
 * Node types intentionally avoid Hint/Memory/Clip/Turn — `kgSearch` filters
 * those out client-side before anything downstream would ever see them.
 */
export const mockSearchNodes: MockSearchNode[] = [
  // --- Partition "acme-core" (via properties.namespace) --------------------
  {
    ref_id: "repo-hive-main",
    node_type: "Repository",
    name: "hive",
    properties: {
      namespace: "acme-core",
      name: "hive",
      description:
        "AI-first PM toolkit monorepo. Next.js 15 App Router frontend backed by PostgreSQL via Prisma, with agent tooling for workspaces, swarms, and workflow automation.",
      domains: ["entity"],
    },
    edges: { OWNS: 12, PUSHED: 5 },
  },
  {
    ref_id: "fn-parse-config",
    node_type: "Function",
    properties: {
      namespace: "acme-core",
      function_name: "parseConfig",
      file_name: "src/config/env.ts",
      description:
        "Parses environment variables into a typed config object, applying defaults and failing fast on missing required keys.",
    },
  },
  {
    ref_id: "file-kg-adapter-ts",
    node_type: "File",
    properties: {
      namespace: "acme-core",
      file_name: "src/lib/ai/kg-adapter.ts",
      summary:
        "HTTP client for Jarvis v2 knowledge-graph read endpoints: search, neighbors, ontology, and single-node schema lookups.",
      domains: ["entity"],
    },
  },
  {
    // Dual placement with CONFLICTING values pins the precedence rule:
    // properties.namespace ("acme-core") must win over the stale top-level
    // value ("audit-archive").
    ref_id: "pr-5175",
    node_type: "PullRequest",
    namespace: "audit-archive",
    name: "feat: graph-walker label canonicalization",
    properties: {
      namespace: "acme-core",
      title: "feat: graph-walker label canonicalization",
      description:
        "Resolves multi-word and mixed-case Neo4j labels via Jarvis's canonical_type resolver instead of naive capitalization.",
    },
  },

  // --- Partition "research-lab" (via properties.namespace) -----------------
  {
    ref_id: "feat-graph-walker",
    node_type: "HiveFeature",
    properties: {
      namespace: "research-lab",
      name: "Graph Walker",
      description:
        "Knowledge-graph traversal system exposing graph_get/graph_neighbors/graph_search/graph_ontology tools to AI agents across pg, canvas, and kg realms.",
    },
  },
  {
    ref_id: "task-ns-parity",
    node_type: "HiveTask",
    properties: {
      namespace: "research-lab",
      title: "Expose optional namespace on graph search tools",
      text: "Thread an optional namespace through kgSearch into the /v2/nodes query string so agents can target a specific data partition.",
    },
  },

  // --- Partition "platform-governance" (top-level namespace ONLY — proves
  //     the fallback path; properties.namespace is absent here) -------------
  {
    ref_id: "concept-error-budgets",
    node_type: "Concept",
    namespace: "platform-governance",
    properties: {
      name: "Error Budgets",
      description:
        "SLO practice: the tolerated failure rate before feature work is paused in favour of reliability work.",
    },
  },

  // --- Default partition: NO namespace anywhere ----------------------------
  {
    ref_id: "fn-auth-token-verify",
    node_type: "Function",
    properties: {
      function_name: "verifyAuthToken",
      file_name: "src/middleware/auth.ts",
      description: "Validates signed session tokens and attaches the resolved user identity to the request context.",
    },
  },
  {
    ref_id: "readme-root-md",
    node_type: "File",
    properties: {
      file_name: "README.md",
      summary: "Project overview, local setup instructions, and pointers to architecture docs.",
      domains: ["content"],
    },
  },
  {
    ref_id: "skill-summarize-pr",
    node_type: "Skill",
    name: "summarize-pr",
    properties: {
      name: "summarize-pr",
      description:
        "Produces a short executive summary of a pull request's intent, risk areas, and test coverage from its diff.",
    },
  },
];
