import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for graph tree/map traversal.
 * Returns a hardcoded plain-text ASCII tree wrapped in <pre> tags.
 * Real stakgraph /map endpoint returns plain text (not JSON).
 */
export async function GET() {
  const asciiTree = `<pre>
validateWorkspaceAccess (Function) [src/services/workspace.ts]
├── db (Variable) [src/lib/db.ts]
│   └── PrismaClient (Class) [node_modules/@prisma/client]
├── EncryptionService (Class) [src/lib/encryption.ts]
│   └── decryptField (Function) [src/lib/encryption.ts]
└── WorkspaceRole (Enum) [src/lib/auth/roles.ts]
    ├── OWNER
    ├── ADMIN
    ├── PM
    ├── DEVELOPER
    ├── STAKEHOLDER
    └── VIEWER
</pre>`;

  return new NextResponse(asciiTree, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
