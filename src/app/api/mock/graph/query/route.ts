import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for Cypher graph queries.
 * Returns a hardcoded ArcadeDB-format result simulating:
 *   MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10
 */
export async function POST() {
  const result = [
    {
      n: {
        "@rid": "#1:0",
        "@type": "File",
        name: "AuthService.ts",
        path: "src/lib/auth/AuthService.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:0",
        "@type": "IMPORTS",
        weight: 1,
      },
      m: {
        "@rid": "#2:0",
        "@type": "File",
        name: "db.ts",
        path: "src/lib/db.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#1:0",
        "@type": "File",
        name: "AuthService.ts",
        path: "src/lib/auth/AuthService.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:1",
        "@type": "IMPORTS",
        weight: 1,
      },
      m: {
        "@rid": "#3:0",
        "@type": "File",
        name: "encryption.ts",
        path: "src/lib/encryption.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#2:0",
        "@type": "File",
        name: "db.ts",
        path: "src/lib/db.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:2",
        "@type": "USES",
        weight: 3,
      },
      m: {
        "@rid": "#4:0",
        "@type": "Class",
        name: "PrismaClient",
        path: "node_modules/@prisma/client",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#5:0",
        "@type": "Function",
        name: "getServerSession",
        path: "src/lib/auth/nextauth.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:3",
        "@type": "CALLS",
        weight: 5,
      },
      m: {
        "@rid": "#1:0",
        "@type": "File",
        name: "AuthService.ts",
        path: "src/lib/auth/AuthService.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#6:0",
        "@type": "File",
        name: "workspace.ts",
        path: "src/services/workspace.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:4",
        "@type": "IMPORTS",
        weight: 2,
      },
      m: {
        "@rid": "#2:0",
        "@type": "File",
        name: "db.ts",
        path: "src/lib/db.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#7:0",
        "@type": "Class",
        name: "EncryptionService",
        path: "src/lib/encryption.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:5",
        "@type": "DEFINED_IN",
        weight: 1,
      },
      m: {
        "@rid": "#3:0",
        "@type": "File",
        name: "encryption.ts",
        path: "src/lib/encryption.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#8:0",
        "@type": "Function",
        name: "validateWorkspaceAccess",
        path: "src/services/workspace.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:6",
        "@type": "DEFINED_IN",
        weight: 1,
      },
      m: {
        "@rid": "#6:0",
        "@type": "File",
        name: "workspace.ts",
        path: "src/services/workspace.ts",
        language: "typescript",
      },
    },
    {
      n: {
        "@rid": "#9:0",
        "@type": "File",
        name: "route.ts",
        path: "src/app/api/workspaces/[slug]/graph/query/route.ts",
        language: "typescript",
      },
      r: {
        "@rid": "#10:7",
        "@type": "CALLS",
        weight: 2,
      },
      m: {
        "@rid": "#8:0",
        "@type": "Function",
        name: "validateWorkspaceAccess",
        path: "src/services/workspace.ts",
        language: "typescript",
      },
    },
  ];

  return NextResponse.json({ result }, { status: 200 });
}
