import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { decryptMcpHeaders, probeMcpServer } from "@/lib/ai/externalMcpTools";
import { isMcpTimeout } from "@/lib/ai/mcpTimeout";
import { z } from "zod";

const testSchema = z.object({
  /** Probe a saved server (uses its stored URL/headers unless overridden). */
  serverId: z.string().optional(),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), "URL must be http(s)")
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/**
 * POST /api/orgs/[githubLogin]/mcp-servers/test
 * Connect to an MCP server and list its tools (admin only). Used by the
 * settings UI both to verify credentials before saving and to populate
 * the tool-filter picker. Accepts either a saved `serverId` (stored
 * headers are reused so secrets need not be re-entered) or an ad-hoc
 * `url` + `headers` for a not-yet-saved server.
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

  let data: z.infer<typeof testSchema>;
  try {
    data = testSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let url = data.url;
  let headers = data.headers ?? {};
  if (data.serverId) {
    const server = await db.orgMcpServer.findFirst({
      where: { id: data.serverId, sourceControlOrgId: orgId },
    });
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    url = url ?? server.url;
    if (!data.headers) headers = decryptMcpHeaders(server.headers, server.name);
  }
  if (!url) {
    return NextResponse.json({ error: "Either url or serverId is required" }, { status: 400 });
  }

  try {
    const tools = await probeMcpServer({ url, headers });
    return NextResponse.json({ ok: true, tools });
  } catch (error) {
    const message = isMcpTimeout(error)
      ? "Connection timed out — is the server reachable?"
      : error instanceof Error
        ? error.message
        : "Failed to connect";
    // 200 with ok:false — a failed probe is an expected outcome the UI
    // renders inline, not a route error.
    return NextResponse.json({ ok: false, error: message });
  }
}
