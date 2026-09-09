import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { encryptMcpHeaders, mcpServerCreateSchema, serializeMcpServer } from "@/lib/mcp/orgMcpServerConfig";
import { z } from "zod";

/**
 * GET /api/orgs/[githubLogin]/mcp-servers
 * List the org's external MCP servers (admin only; header values omitted).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const servers = await db.orgMcpServer.findMany({
      where: { sourceControlOrgId: orgId },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ servers: servers.map(serializeMcpServer) });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/mcp-servers]", error);
    return NextResponse.json({ error: "Failed to list MCP servers" }, { status: 500 });
  }
}

/**
 * POST /api/orgs/[githubLogin]/mcp-servers
 * Register an external MCP server for the org (admin only).
 * Headers are encrypted at rest and never returned.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  let data: z.infer<typeof mcpServerCreateSchema>;
  try {
    data = mcpServerCreateSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const server = await db.orgMcpServer.create({
      data: {
        sourceControlOrgId: orgId,
        name: data.name,
        url: data.url,
        headers: data.headers && Object.keys(data.headers).length > 0 ? encryptMcpHeaders(data.headers) : null,
        toolFilter: data.toolFilter ?? [],
        enabled: data.enabled ?? true,
      },
    });
    return NextResponse.json({ server: serializeMcpServer(server) }, { status: 201 });
  } catch (error) {
    // Unique (org, name) violation → 409
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `An MCP server named "${data.name}" already exists for this org` },
        { status: 409 },
      );
    }
    console.error("[POST /api/orgs/[githubLogin]/mcp-servers]", error);
    return NextResponse.json({ error: "Failed to create MCP server" }, { status: 500 });
  }
}
