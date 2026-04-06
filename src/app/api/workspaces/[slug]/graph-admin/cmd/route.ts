import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getSwarmCmdJwt, swarmCmdRequest, SwarmCmd } from "@/services/swarm/cmd";

export const runtime = "nodejs";

const ALLOWED_CMDS = new Set([
  "GetBoltwallAccessibility",
  "UpdateBoltwallAccessibility",
  "ListPaidEndpoint",
  "UpdatePaidEndpoint",
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // 1. Auth
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, userId, true);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
  }
  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // 2. Guard: graph_mindset only
  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { workspaceKind: true },
  });
  if (workspace?.workspaceKind !== "graph_mindset") {
    return NextResponse.json({ error: "Not a GraphMindset workspace" }, { status: 403 });
  }

  // 3. Parse cmd from body
  const body = await request.json();
  const { cmd } = body as { cmd?: SwarmCmd };
  if (!cmd) {
    return NextResponse.json({ error: "Missing cmd" }, { status: 400 });
  }

  // Validate cmd is one of the allowed graph-admin variants
  const cmdName = (cmd as { type?: string; data?: { cmd?: string } }).data?.cmd;
  if (!cmdName || !ALLOWED_CMDS.has(cmdName)) {
    return NextResponse.json(
      { error: `Invalid cmd: must be one of ${[...ALLOWED_CMDS].join(", ")}` },
      { status: 400 },
    );
  }

  // 4. Resolve swarm URL + password
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { swarmUrl: true, swarmPassword: true },
  });
  if (!swarm?.swarmUrl) {
    return NextResponse.json({ error: "Swarm not configured" }, { status: 404 });
  }

  // 5. Guard: swarmPassword must be set
  if (!swarm.swarmPassword) {
    return NextResponse.json({ error: "Swarm password not configured" }, { status: 502 });
  }

  // 6. Decrypt + authenticate
  const encryptionService = EncryptionService.getInstance();
  let password: string;
  try {
    password = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return NextResponse.json({ error: "Failed to decrypt swarm password" }, { status: 500 });
  }

  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(swarm.swarmUrl, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Swarm login failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 7. Proxy cmd
  const result = await swarmCmdRequest({ swarmUrl: swarm.swarmUrl, jwt, cmd });
  if (!result.ok) {
    return NextResponse.json(
      { error: "Swarm cmd failed", status: result.status, swarm: result.data ?? result.rawText },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data ?? result.rawText);
}
