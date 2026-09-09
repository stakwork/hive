import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { encryptMcpHeaders, mcpServerUpdateSchema, serializeMcpServer } from "@/lib/mcp/orgMcpServerConfig";
import { z } from "zod";

async function resolveServer(request: NextRequest, params: Promise<{ githubLogin: string; serverId: string }>) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return { ok: false as const, response: userOrResponse };

  const { githubLogin, serverId } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Organization not found" }, { status: 404 }),
    };
  }

  // Scope the lookup to the org so a serverId from another org 404s.
  const server = await db.orgMcpServer.findFirst({
    where: { id: serverId, sourceControlOrgId: orgId },
  });
  if (!server) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "MCP server not found" }, { status: 404 }),
    };
  }
  return { ok: true as const, server };
}

/**
 * PATCH /api/orgs/[githubLogin]/mcp-servers/[serverId]
 * Partial update (admin only). `headers` semantics: omitted = keep,
 * null = clear, object = replace (encrypted at rest).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; serverId: string }> },
): Promise<NextResponse> {
  const resolved = await resolveServer(request, params);
  if (!resolved.ok) return resolved.response;
  const { server } = resolved;

  let data: z.infer<typeof mcpServerUpdateSchema>;
  try {
    data = mcpServerUpdateSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const updated = await db.orgMcpServer.update({
      where: { id: server.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.toolFilter !== undefined ? { toolFilter: data.toolFilter } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.headers !== undefined
          ? {
              headers: data.headers && Object.keys(data.headers).length > 0 ? encryptMcpHeaders(data.headers) : null,
            }
          : {}),
      },
    });
    return NextResponse.json({ server: serializeMcpServer(updated) });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `An MCP server named "${data.name}" already exists for this org` },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/orgs/[githubLogin]/mcp-servers/[serverId]]", error);
    return NextResponse.json({ error: "Failed to update MCP server" }, { status: 500 });
  }
}

/**
 * DELETE /api/orgs/[githubLogin]/mcp-servers/[serverId]
 * Remove a registered MCP server (admin only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; serverId: string }> },
): Promise<NextResponse> {
  const resolved = await resolveServer(request, params);
  if (!resolved.ok) return resolved.response;
  const { server } = resolved;

  try {
    await db.orgMcpServer.delete({ where: { id: server.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/mcp-servers/[serverId]]", error);
    return NextResponse.json({ error: "Failed to delete MCP server" }, { status: 500 });
  }
}
