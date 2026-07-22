import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for Cypher graph queries.
 * Returns a hardcoded stakgraph-format result simulating:
 *   MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10
 *
 * Node objects use `ref_id` + `node_type` to match the real stakgraph response shape.
 * Relationship objects only carry `{ type }` — no `id` or `ref_id`.
 */
export async function POST() {
  return NextResponse.json(
    {
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
    },
    { status: 200 },
  );
}
