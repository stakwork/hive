/**
 * Pure, request-free mock graph-query result builder.
 *
 * Extracted from `route.ts` so it can live outside the Next.js route module:
 * the mock route is now a thin wrapper over this, and
 * `runWorkspaceGraphQuery` (src/services/graph/query.ts) calls this function
 * directly under USE_MOCKS — one fixture, two callers, no HTTP hop (the tool
 * path must not resolve to a nonexistent `/api/mock/stakgraph/api/hive/query`
 * route).
 *
 * Do NOT add Next.js (`next/server`) imports here — keeping this module free
 * of request/response types is what makes it safe to import from services.
 */

import {
  buildRecursionCypherFixture,
  isLegalRecursionQuery,
} from "../recursion-cypher-fixture";

export interface BuildMockGraphQueryResultArgs {
  query?: string;
  /** Accepted for call-site symmetry; the fixture does not paginate. */
  limit?: number;
}

/**
 * Default stakgraph-format result simulating:
 *   MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10
 *
 * Node objects use `ref_id` + `node_type` to match the real stakgraph response shape.
 * Relationship objects only carry `{ type }` — no `id` or `ref_id`.
 */
const DEFAULT_CODE_GRAPH_RESULT = {
  columns: ["n", "r", "m"],
  rows: [
    [
      { ref_id: "ref_auth_service", name: "AuthService.ts", node_type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
      { type: "IMPORTS" },
      { ref_id: "ref_db", name: "db.ts", node_type: "File", path: "src/lib/db.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_auth_service", name: "AuthService.ts", node_type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
      { type: "IMPORTS" },
      { ref_id: "ref_encryption", name: "encryption.ts", node_type: "File", path: "src/lib/encryption.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_db", name: "db.ts", node_type: "File", path: "src/lib/db.ts", language: "typescript" },
      { type: "USES" },
      { ref_id: "ref_prisma_client", name: "PrismaClient", node_type: "Class", path: "node_modules/@prisma/client", language: "typescript" },
    ],
    [
      { ref_id: "ref_get_server_session", name: "getServerSession", node_type: "Function", path: "src/lib/auth/nextauth.ts", language: "typescript" },
      { type: "CALLS" },
      { ref_id: "ref_auth_service", name: "AuthService.ts", node_type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_workspace_service", name: "workspace.ts", node_type: "File", path: "src/services/workspace.ts", language: "typescript" },
      { type: "IMPORTS" },
      { ref_id: "ref_db", name: "db.ts", node_type: "File", path: "src/lib/db.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_encryption_service", name: "EncryptionService", node_type: "Class", path: "src/lib/encryption.ts", language: "typescript" },
      { type: "DEFINED_IN" },
      { ref_id: "ref_encryption", name: "encryption.ts", node_type: "File", path: "src/lib/encryption.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_validate_workspace_access", name: "validateWorkspaceAccess", node_type: "Function", path: "src/services/workspace.ts", language: "typescript" },
      { type: "DEFINED_IN" },
      { ref_id: "ref_workspace_service", name: "workspace.ts", node_type: "File", path: "src/services/workspace.ts", language: "typescript" },
    ],
    [
      { ref_id: "ref_graph_query_route", name: "route.ts", node_type: "File", path: "src/app/api/workspaces/[slug]/graph/query/route.ts", language: "typescript" },
      { type: "CALLS" },
      { ref_id: "ref_validate_workspace_access", name: "validateWorkspaceAccess", node_type: "Function", path: "src/services/workspace.ts", language: "typescript" },
    ],
  ],
} as const;

/**
 * Build the mock Cypher query result for the given query.
 *
 * - Legal recursion subgraph queries return the dedicated recursion fixture.
 * - Everything else returns the default code-graph fixture.
 *
 * Mirrors the previous inline behavior of the mock route exactly (same body,
 * same status — always 200).
 */
export function buildMockGraphQueryResult({
  query = "",
}: BuildMockGraphQueryResultArgs): { columns: string[]; rows: unknown[][] } {
  if (isLegalRecursionQuery(query)) {
    return buildRecursionCypherFixture();
  }

  // The static data above is `as const`; hand back a mutable plain-object copy.
  return JSON.parse(JSON.stringify(DEFAULT_CODE_GRAPH_RESULT));
}
