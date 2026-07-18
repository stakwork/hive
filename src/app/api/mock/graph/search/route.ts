import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for graph keyword/semantic search.
 * Returns a hardcoded list of { name, file, ref_id } items.
 */
export async function GET() {
  return NextResponse.json(
    [
      {
        name: "validateWorkspaceAccess",
        file: "src/services/workspace.ts",
        ref_id: "validateWorkspaceAccess_src_services_workspace_ts",
      },
      {
        name: "EncryptionService",
        file: "src/lib/encryption.ts",
        ref_id: "EncryptionService_src_lib_encryption_ts",
      },
      {
        name: "getServerSession",
        file: "src/lib/auth/nextauth.ts",
        ref_id: "getServerSession_src_lib_auth_nextauth_ts",
      },
      {
        name: "GraphExplorer",
        file: "src/components/graph-explorer/GraphExplorer.tsx",
        ref_id: "GraphExplorer_src_components_graph_explorer_GraphExplorer_tsx",
      },
      {
        name: "db",
        file: "src/lib/db.ts",
        ref_id: "db_src_lib_db_ts",
      },
    ],
    { status: 200 },
  );
}
