import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for Cypher graph queries.
 * Returns a hardcoded stakgraph-format result simulating:
 *   MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10
 */
export async function POST() {
  return NextResponse.json(
    {
      columns: ["n", "r", "m"],
      rows: [
        [
          { id: "1", name: "AuthService.ts", type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
          { id: "10", type: "IMPORTS" },
          { id: "2", name: "db.ts", type: "File", path: "src/lib/db.ts", language: "typescript" },
        ],
        [
          { id: "1", name: "AuthService.ts", type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
          { id: "11", type: "IMPORTS" },
          { id: "3", name: "encryption.ts", type: "File", path: "src/lib/encryption.ts", language: "typescript" },
        ],
        [
          { id: "2", name: "db.ts", type: "File", path: "src/lib/db.ts", language: "typescript" },
          { id: "12", type: "USES" },
          { id: "4", name: "PrismaClient", type: "Class", path: "node_modules/@prisma/client", language: "typescript" },
        ],
        [
          { id: "5", name: "getServerSession", type: "Function", path: "src/lib/auth/nextauth.ts", language: "typescript" },
          { id: "13", type: "CALLS" },
          { id: "1", name: "AuthService.ts", type: "File", path: "src/lib/auth/AuthService.ts", language: "typescript" },
        ],
        [
          { id: "6", name: "workspace.ts", type: "File", path: "src/services/workspace.ts", language: "typescript" },
          { id: "14", type: "IMPORTS" },
          { id: "2", name: "db.ts", type: "File", path: "src/lib/db.ts", language: "typescript" },
        ],
        [
          { id: "7", name: "EncryptionService", type: "Class", path: "src/lib/encryption.ts", language: "typescript" },
          { id: "15", type: "DEFINED_IN" },
          { id: "3", name: "encryption.ts", type: "File", path: "src/lib/encryption.ts", language: "typescript" },
        ],
        [
          { id: "8", name: "validateWorkspaceAccess", type: "Function", path: "src/services/workspace.ts", language: "typescript" },
          { id: "16", type: "DEFINED_IN" },
          { id: "6", name: "workspace.ts", type: "File", path: "src/services/workspace.ts", language: "typescript" },
        ],
        [
          { id: "9", name: "route.ts", type: "File", path: "src/app/api/workspaces/[slug]/graph/query/route.ts", language: "typescript" },
          { id: "17", type: "CALLS" },
          { id: "8", name: "validateWorkspaceAccess", type: "Function", path: "src/services/workspace.ts", language: "typescript" },
        ],
      ],
    },
    { status: 200 },
  );
}
