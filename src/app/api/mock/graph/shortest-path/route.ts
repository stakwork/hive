import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for graph shortest-path lookup.
 * Returns a hardcoded plain-text snippet showing a path between two nodes.
 * Real stakgraph /shortest_path endpoint returns plain text (not JSON).
 */
export async function GET() {
  const pathText = `Path found between nodes:

Node: validateWorkspaceAccess (Function)
  File: src/services/workspace.ts

  → CALLS →

Node: db (Variable)
  File: src/lib/db.ts

  → USES →

Node: PrismaClient (Class)
  File: node_modules/@prisma/client`;

  return new NextResponse(pathText, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
